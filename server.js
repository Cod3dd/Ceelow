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

const rooms = new Map(); // Only one room ("lobby") for now
const activeSockets = new Map(); // Track logged-in users

io.on('connection', (socket) => {
    socket.on('login', ({ username, password }) => {
        if (activeSockets.has(username)) {
            socket.emit('loginError', 'Already logged in elsewhere');
            return;
        }
        if (!playersData[username]) {
            playersData[username] = { password, coins: 100 };
            savePlayersData();
        } else if (playersData[username].password !== password) {
            socket.emit('loginError', 'Wrong password');
            return;
        }
        activeSockets.set(username, socket.id);
        socket.emit('loginSuccess', { username, coins: playersData[username].coins });
    });

    socket.on('joinRoom', ({ username }) => {
        if (!activeSockets.has(username) || activeSockets.get(username) !== socket.id) return;
        const roomCode = 'lobby'; // Fixed room for simplicity
        socket.join(roomCode);
        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, { players: [], bets: new Map(), rolls: new Map(), turn: 0, active: false });
        }
        const room = rooms.get(roomCode);
        const player = { id: socket.id, name: username, coins: playersData[username].coins };
        if (!room.players.some(p => p.name === player.name)) {
            room.players.push(player);
        }
        socket.emit('joined', { roomCode, player });
        io.to(roomCode).emit('updatePlayers', room.players);
        io.to(roomCode).emit('roomStatus', { canPlay: room.players.length >= 2 });
    });

    socket.on('placeBet', ({ username, bet }) => {
        const room = rooms.get('lobby');
        if (!room || room.active || room.players.length < 2) return;
        const player = room.players.find(p => p.name === username);
        if (player && player.coins >= bet && !room.bets.has(player.id)) {
            room.bets.set(player.id, bet);
            player.coins -= bet;
            playersData[username].coins = player.coins;
            savePlayersData();
            io.to('lobby').emit('updatePlayers', room.players);
            if (room.bets.size === room.players.length) {
                room.active = true;
                io.to('lobby').emit('nextTurn', { playerName: room.players[0].name });
            }
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
        if (username) activeSockets.delete(username);
        const room = rooms.get('lobby');
        if (room) {
            const playerIdx = room.players.findIndex(p => p.id === socket.id);
            if (playerIdx !== -1) {
                room.players.splice(playerIdx, 1);
                room.bets.delete(socket.id);
                room.rolls.delete(socket.id);
                io.to('lobby').emit('updatePlayers', room.players);
                io.to('lobby').emit('roomStatus', { canPlay: room.players.length >= 2 });
                if (room.players.length === 0) rooms.delete('lobby');
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
            if (attempts > 10) return [1, 1, 1]; // Fallback
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
