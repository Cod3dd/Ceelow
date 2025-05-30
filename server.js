const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "https://ceelow.onrender.com", methods: ["GET", "POST"], credentials: true }
});

app.use(express.static(path.join(__dirname, 'public')));

// Player data persistence
const DATA_FILE = './players.json';
let playersData = {};
if (fs.existsSync(DATA_FILE)) {
    playersData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

const rooms = new Map();
const activeSockets = new Map();

io.on('connection', (socket) => {
    socket.on('createAccount', ({ username, password }) => {
        if (playersData[username]) {
            socket.emit('accountError', 'Username already taken');
            return;
        }
        playersData[username] = { password, coins: 100 };
        savePlayersData();
        activeSockets.set(username, socket.id);
        socket.emit('accountCreated', { username, coins: 100 });
    });

    socket.on('login', ({ username, password }) => {
        if (activeSockets.has(username)) {
            socket.emit('loginError', 'Already logged in elsewhere');
            return;
        }
        if (!playersData[username]) {
            socket.emit('loginError', 'Username not found');
            return;
        }
        if (playersData[username].password !== password) {
            socket.emit('loginError', 'Wrong password');
            return;
        }
        activeSockets.set(username, socket.id);
        socket.emit('loginSuccess', { username, coins: playersData[username].coins });
    });

    socket.on('joinRoom', ({ username, roomCode = 'lobby' }) => {
        if (!activeSockets.has(username) || activeSockets.get(username) !== socket.id) {
            socket.emit('joinError', 'Not logged in');
            return;
        }
        socket.join(roomCode);
        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, { 
                players: [], 
                bets: new Map(), 
                rolls: new Map(), 
                turn: 0, 
                active: false, 
                requiredBet: 0,
                maxBet: Infinity 
            });
        }
        const room = rooms.get(roomCode);
        const player = { id: socket.id, name: username, coins: playersData[username].coins };
        if (!room.players.some(p => p.name === player.name)) {
            room.players.push(player);
        }
        if (room.players.length >= 2) {
            room.maxBet = Math.min(...room.players.map(p => p.coins));
        }
        socket.emit('joined', { roomCode, player });
        io.to(roomCode).emit('updatePlayers', room.players);
        io.to(roomCode).emit('roomStatus', { 
            canPlay: room.players.length >= 2 && room.players.every(p => p.coins > 0),
            maxBet: room.maxBet
        });
    });

    socket.on('placeBet', ({ username, bet }) => {
        const room = rooms.get('lobby');
        if (!room || room.active || room.players.length < 2) return;
        if (room.players.some(p => p.coins === 0)) {
            io.to('lobby').emit('betError', 'A player has 0 coins—betting paused');
            return;
        }
        const player = room.players.find(p => p.name === username);
        if (!player || player.coins < bet || bet > room.maxBet) {
            socket.emit('betError', `Bet must be 1 to ${Math.min(player.coins, room.maxBet)}`);
            return;
        }
        if (room.bets.size > 0 && bet !== room.requiredBet && room.requiredBet !== 0) {
            socket.emit('matchBet', { requiredBet: room.requiredBet });
            return;
        }
        room.bets.set(player.id, bet);
        if (bet > room.requiredBet) {
            room.requiredBet = bet;
            // Notify other players to match
            room.players.forEach(p => {
                if (p.name !== username && room.bets.has(p.id)) {
                    io.to(p.id).emit('matchBet', { requiredBet: bet });
                    room.bets.delete(p.id); // Clear their old bet
                    p.coins += room.bets.get(p.id) || 0; // Refund
                    playersData[p.name].coins = p.coins;
                }
            });
            savePlayersData();
        }
        player.coins -= bet;
        playersData[username].coins = player.coins;
        savePlayersData();
        io.to('lobby').emit('updatePlayers', room.players);
        io.to('lobby').emit('betPlaced', { username, bet, requiredBet: room.requiredBet });
        if (room.bets.size === room.players.length && [...room.bets.values()].every(b => b === room.requiredBet)) {
            room.active = true;
            io.to('lobby').emit('nextTurn', { playerName: room.players[0].name });
        }
    });

    socket.on('matchBet', ({ username, bet }) => {
        const room = rooms.get('lobby');
        if (!room || room.active || room.players.length < 2) return;
        const player = room.players.find(p => p.name === username);
        if (!player || bet !== room.requiredBet || player.coins < bet) {
            socket.emit('betError', `Must match ${room.requiredBet} or leave`);
            return;
        }
        room.bets.set(player.id, bet);
        player.coins -= bet;
        playersData[username].coins = player.coins;
        savePlayersData();
        io.to('lobby').emit('updatePlayers', room.players);
        io.to('lobby').emit('betPlaced', { username, bet, requiredBet: room.requiredBet });
        if (room.bets.size === room.players.length && [...room.bets.values()].every(b => b === room.requiredBet)) {
            room.active = true;
            io.to('lobby').emit('nextTurn', { playerName: room.players[0].name });
        }
    });

    socket.on('leaveRoom', ({ username }) => {
        const room = rooms.get('lobby');
        if (!room) return;
        const playerIdx = room.players.findIndex(p => p.name === username);
        if (playerIdx !== -1) {
            const player = room.players[playerIdx];
            room.players.splice(playerIdx, 1);
            room.bets.delete(player.id);
            room.rolls.delete(player.id);
            if (room.bets.size > 0) {
                room.requiredBet = Math.max(...room.bets.values());
            } else {
                room.requiredBet = 0;
            }
            io.to('lobby').emit('updatePlayers', room.players);
            io.to('lobby').emit('roomStatus', { 
                canPlay: room.players.length >= 2 && room.players.every(p => p.coins > 0),
                maxBet: room.maxBet
            });
            if (room.players.length === 0) rooms.delete('lobby');
        }
    });

    socket.on('rollDice', ({ username }) => {
        const room = rooms.get('lobby');
        if (!room || !room.active || room.players.length < 2) return;
        const player = room.players[room.turn];
        if (player.name !== username || player.id !== socket.id) return;

        const dice = rollDice();
        const result = getCeeloResult(dice);
        const point = calculatePoint(result);
        room.rolls.set(player.id, { dice, result, point });
        io.to('lobby').emit('diceRolled', { player: player.name, dice, result });

        if (result.includes("Win")) {
            endRound(room, player);
        } else if (result.includes("Loss")) {
            const winner = room.players.find(p => p.id !== player.id) || room.players[0];
            endRound(room, winner);
        } else {
            room.turn = (room.turn + 1) % room.players.length;
            if (room.rolls.size === room.players.length) {
                determineWinner(room);
            } else {
                io.to('lobby').emit('nextTurn', { playerName: room.players[room.turn].name });
            }
        }
    });

    socket.on('disconnect', () => {
        const username = [...activeSockets.entries()].find(([_, id]) => id === socket.id)?.[0];
        if (username) {
            activeSockets.delete(username);
            const room = rooms.get('lobby');
            if (room) {
                const playerIdx = room.players.findIndex(p => p.id === socket.id);
                if (playerIdx !== -1) {
                    room.players.splice(playerIdx, 1);
                    room.bets.delete(socket.id);
                    room.rolls.delete(socket.id);
                    if (room.bets.size > 0) {
                        room.requiredBet = Math.max(...room.bets.values());
                    } else {
                        room.requiredBet = 0;
                    }
                    io.to('lobby').emit('updatePlayers', room.players);
                    io.to('lobby').emit('roomStatus', { 
                        canPlay: room.players.length >= 2 && room.players.every(p => p.coins > 0),
                        maxBet: room.maxBet
                    });
                    if (room.players.length === 0) rooms.delete('lobby');
                }
            }
        }
    });

    function rollDice() {
        let dice, result;
        let attempts = 0;
        do {
            dice = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1);
            result = getCeeloResult(dice);
            attempts++;
            if (attempts > 10) return [1, 1, 1];
        } while (!isValidResult(result));
        return dice;
    }

    function getCeeloResult(dice) {
        const sorted = [...dice].sort();
        const [d1, d2, d3] = sorted;
        if (d1 === 4 && d2 === 5 && d3 === 6) return "4-5-6! Win!";
        if (d1 === 1 && d2 === 2 && d3 === 3) return "1-2-3! Loss!";
        if (d1 === d2 && d2 === d3) return `Trips ${d1}!`;
        if (d1 === d2) return `Pair ${d1}, Point: ${d3}`;
        if (d2 === d3) return `Pair ${d2}, Point: ${d1}`;
        if (d1 === d3) return `Pair ${d1}, Point: ${d2}`;
        return "Invalid";
    }

    function calculatePoint(result) {
        if (result.includes("Win")) return Infinity;
        if (result.includes("Loss")) return -Infinity;
        if (result.includes("Trips")) return parseInt(result.match(/Trips (\d+)/)[1]);
        if (result.includes("Pair")) return parseInt(result.match(/Point: (\d+)/)[1]);
        return 0;
    }

    function isValidResult(result) {
        return result.includes("Win") || result.includes("Loss") || result.includes("Trips") || result.includes("Pair");
    }

    function endRound(room, winner) {
        const pot = Array.from(room.bets.values()).reduce((a, b) => a + b, 0);
        winner.coins += pot;
        playersData[winner.name].coins = winner.coins;
        savePlayersData();
        io.to('lobby').emit('gameOver', { message: `${winner.name} wins ${pot} coins with ${room.rolls.get(winner.id).result}!` });
        room.active = false;
        room.bets.clear();
        room.rolls.clear();
        room.turn = 0;
        room.requiredBet = 0;
        room.maxBet = room.players.length >= 2 ? Math.min(...room.players.map(p => p.coins)) : Infinity;
        io.to('lobby').emit('roundReset');
    }

    function determineWinner(room) {
        let highestPoint = -Infinity;
        let winner = null;
        for (const [id, roll] of room.rolls) {
            if (roll.point > highestPoint) {
                highestPoint = roll.point;
                winner = room.players.find(p => p.id === id);
            }
        }
        endRound(room, winner || room.players[0]);
    }
});

function savePlayersData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(playersData, null, 2));
}

server.listen(process.env.PORT || 3000, () => console.log(`Server on ${process.env.PORT || 3000}`));
