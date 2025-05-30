const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

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
const publicChatMessages = [];

function generateRoomCode() {
    const code = uuidv4().replace(/-/g, '').slice(0, 6).toUpperCase();
    if (rooms.has(code)) {
        console.warn(`Room code collision detected: ${code}. Retrying...`);
        return generateRoomCode();
    }
    return code;
}

io.on('connection', (socket) => {
    socket.on('createAccount', ({ username, _ }) => {
        if (playersData[username]) {
            socket.emit('username taken', 'Username already taken');
            return;
        }
        playersData[username'] = { username, password, coins: 100 };
        savePlayersData();
        activeSockets.set(username, socket.id);
        socket.emit('username', username);
        socket.join('publicChat');
        socket.emit('publicChatMessages', publicChatMessages);
    });

    socket.on('login', ({ username, password }) => {
        if (activeSockets.has(username)) {
            socket.emit('error', 'Already logged in elsewhere');
            return;
        }
        if (!playersData[username]) {
            socket.emit('error', 'Username not found');
            return;
        }
        if (playersData[username].password !== password) {
            socket.emit('error', 'Wrong password');
            return;
        }
        activeSockets.set(username, socket.id);
        socket.emit('setUsername', { username, coins: playersData[username].coins });
        socket.join('publicChat');
        socket.emit('publicChatMessages', publicChatMessages);
    });

    socket.on('sendPublicChat', ({ username, message }) => {
        if (!activeSockets.has(username) || activeSockets.get(username) !== socket.id) return;
        const chatMessage = { username, message, timestamp: new Date().toISOString() };
        publicChatMessages.push(chatMessage);
        io.to('publicChat').emit('receivePublicChat', chatMessage);
    });

    socket.on('createRoom', ({ username, gameMode }) => {
        if (!activeSockets.has(username) || activeSockets.get(username) !== socket.id) {
            socket.emit('error', 'Not logged in');
            return;
        }
        // Ensure player isn't in another room
        const currentRoom = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (currentRoom) {
            socket.emit('error', 'Leave current room before creating a new one!');
            return;
        }
        const validModes = ['single', 'bo3', 'bo5'];
        if (!validModes.includes(gameMode)) {
            socket.emit('error', 'Invalid game mode');
            return;
        }
        const roomCode = generateRoomCode();
        rooms.set(roomCode, { 
            players: [], 
            bets: new Map(), 
            rolls: new Map(), 
            turn: true,
            active: false, 
            requiredBet: 0,
            maxBet: Infinity,
            gameMode,
            roundWins: new Map(),
            totalPot: 0,
            chatMessages: []
        });
        socket.emit('roomCreated', { roomCode, gameMode });
        socket.emit('join', { username, roomCode });
    });

    socket.on('join', ({ username, roomCode }) => {
        if (!activeSockets.has(username) || activeSockets.get(username) !== socket.id) {
            socket.emit('error', 'Not logged in');
            return;
        }
        const normalizedCode = normalizeRoomCode(roomCode);
        if (!rooms.has(normalizedCode)) {
            socket.emit('error', 'Room not found');
            return;
        }
        // Leave any existing room
        const currentRoom = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (currentRoom) {
            leaveRoom(socket, username, currentRoom);
        }
        socket.join(normalizedCode);
        const room = rooms.get(normalizedCode);
        const player = { id: socket.id, username, coins: playersData[username].coins };
        if (!room.players.some(p => p.name === player.name)) {
            room.players.push(player);
            room.roundWins.set(player.id, 0);
        }
        if (room.players.length >= 2) {
            const maxRounds = room.gameMode === 'bo3' ? 3 : room.gameMode === 'bo5' ? 5 : 1;
            const remainingRounds = maxRounds - room.roundNumber + 1;
            room.maxBet = Math.min(...room.players.map(p => Math.floor(p.coins / remainingRounds)));
        }
        socket.emit('joined', { roomCode: normalizedCode, player, gameMode: room.gameMode, chatMessages: room.chatMessages });
        io.to(normalizedCode).emit('updatePlayers', room.players);
        io.to(normalizedCode).emit('roomStatus', { 
            active: room.active,
            maxBet: room.maxBet,
            gameMode: room.gameMode,
            roundNumber: room.roundNumber,
            wins: Object.fromEntries(room.roundWins)
        });
    });

    socket.on('sendChat', ({ username, message }) => {
        const roomCode = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room || !room.players.some(p => p.name === username)) return;
        const chatMessage = { username, message, timestamp: new Date().toISOString() };
        room.chatMessages.push(chatMessage);
        io.to(roomCode).emit('receiveChat', chatMessage);
    });

    socket.on('placeBet', ({ username, bet }) => {
        const roomCode = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room || room.active || room.players.length < 2) return;
        if (room.players.some(p => p.coins === 0 && !room.bets.has(p.id))) {
            io.to(roomCode).emit('error', 'A player has 0 coins—betting paused');
            endMatchEarly(room);
            return;
        }
        const player = room.players.find(p => p.name === username);
        if (!player || player.coins < bet || bet > room.maxBet) {
            socket.emit('error', `Bet must be 1 to ${Math.min(player.coins, room.maxBet)}`);
            return;
        }
        if (room.bets.size > 0 && bet !== room.requiredBet && room.requiredBet !== 0) {
            socket.emit('matchBet', { requiredBet: room.requiredBet });
            return;
        }
        room.bets.set(player.id, bet);
        if (bet > room.requiredBet) {
            room.requiredBet = bet;
            room.players.forEach(p => {
                if (p.name !== username && room.bets.has(p.id)) {
                    const oldBet = room.bets.get(p.id) || 0;
                    p.coins += oldBet;
                    playersData[p.name].coins = p.coins;
                    room.totalPot -= oldBet;
                    room.bets.delete(p.id);
                    io.to(p.id).emit('matchBet', { requiredBet: bet });
                }
            });
            savePlayersData();
            io.to(roomCode).emit('updatePlayers', room.players);
        }
        player.coins -= bet;
        room.totalPot += bet;
        playersData[username].coins = player.coins;
        savePlayersData();
        io.to(roomCode).emit('updatePlayers', room.players);
        io.to(roomCode).emit('betPlaced', { username, bet, requiredBet: room.requiredBet, totalPot: room.totalPot });
        if (room.bets.size === room.players.length && [...room.bets.values()].every(b => b === room.requiredBet)) {
            room.active = true;
            io.to(roomCode).emit('nextTurn', { playerName: room.players[0].name });
        }
    });

    socket.on('matchBet', ({ username, bet }) => {
        const roomCode = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room || room.active || room.players.length < 2) return;
        const player = room.players.find(p => p.name === username);
        if (!player || bet !== room.requiredBet || player.coins < bet) {
            socket.emit('error', `Must match ${room.requiredBet} or leave`);
            return;
        }
        room.bets.set(player.id, bet);
        player.coins -= bet;
        room.totalPot += bet;
        playersData[username].coins = player.coins;
        savePlayersData();
        io.to(roomCode).emit('updatePlayers', room.players);
        io.to(roomCode).emit('betPlaced', { username, bet, requiredBet: room.requiredBet, totalPot: room.totalPot });
        if (room.bets.size === room.players.length && [...room.bets.values()].every(b => b === room.requiredBet)) {
            room.active = true;
            io.to(roomCode).emit('nextTurn', { playerName: room.players[0].name });
        }
    });

    socket.on('leaveRoom', ({ username }) => {
        const roomCode = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (!roomCode) return;
        leaveRoom(socket, username, roomCode);
    });

    socket.on('rollDice', ({ username }) => {
        const roomCode = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room || !room.active || room.players.length < 2) return;
        const player = room.players[room.turn];
        if (player.name !== username || player.id !== socket.id) return;

        const dice = rollDice();
        const result = getCeeloResult(dice);
        const point = calculatePoint(result);
        room.rolls.set(player.id, { dice, result, point });
        io.to(roomCode).emit('diceRolled', { player: player.name, dice, result });

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
                io.to(roomCode).emit('nextTurn', { playerName: room.players[room.turn].name });
            }
        }
    });

    socket.on('disconnect', () => {
        const username = [...activeSockets.entries()].find(([_, id]) => id === socket.id)?.[0];
        if (username) {
            activeSockets.delete(username);
            const roomCode = [...socket.rooms].find(room => room !== socket.id && room !== 'publicChat');
            if (roomCode) {
                leaveRoom(socket, username, roomCode);
            }
            socket.leave('publicChat');
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
        room.roundWins.set(winner.id, (room.roundWins.get(winner.id) || 0) + 1);
        const winsNeeded = room.gameMode === 'bo3' ? 2 : room.gameMode === 'bo5' ? 3 : 1;
        const maxRounds = room.gameMode === 'bo3' ? 3 : room.gameMode === 'bo5' ? 5 : 1;
        const isMatchOver = room.roundWins.get(winner.id) >= winsNeeded || room.roundNumber >= maxRounds;

        if (isMatchOver) {
            winner.coins += room.totalPot;
            playersData[winner.name].coins = winner.coins;
            room.players.forEach(p => {
                playersData[p.name].coins = p.coins;
            });
            savePlayersData();
            io.to(room.roomCode).emit('gameOver', { 
                message: `${winner.name} wins the match with ${room.roundWins.get(winner.id)}/${winsNeeded} rounds! Pot: ${room.totalPot}`,
                players: room.players
            });
            rooms.delete(room.roomCode);
        } else {
            io.to(room.roomCode).emit('roundOver', { 
                message: `${winner.name} wins round ${room.roundNumber} with ${room.rolls.get(winner.id).result}!`,
                roundWins: Object.fromEntries(room.roundWins)
            });
            room.roundNumber += 1;
            room.active = false;
            room.bets.clear();
            room.rolls.clear();
            room.turn = 0;
            room.requiredBet = 0;
            const remainingRounds = maxRounds - room.roundNumber + 1;
            room.maxBet = room.players.length >= 2 ? Math.min(...room.players.map(p => Math.floor(p.coins / remainingRounds))) : Infinity;
            io.to(room.roomCode).emit('roundReset');
        }
    }

    function endMatchEarly(room) {
        if (room.players.length < 2 || room.players.some(p => p.coins < room.requiredBet && !room.bets.has(p.id))) {
            let winner = null;
            let maxWins = -1;
            for (const [id, wins] of room.roundWins) {
                if (wins > maxWins) {
                    maxWins = wins;
                    winner = room.players.find(p => p.id === id);
                }
            }
            if (winner && room.totalPot > 0) {
                winner.coins += room.totalPot;
                playersData[winner.name].coins = winner.coins;
                room.players.forEach(p => {
                    playersData[p.name].coins = p.coins;
                });
                savePlayersData();
                io.to(room.roomCode).emit('gameOver', { 
                    message: `${winner.name} wins the match early due to insufficient players or coins! Pot: ${room.totalPot}`,
                    players: room.players
                });
            } else {
                room.players.forEach(p => {
                    const bet = room.bets.get(p.id) || 0;
                    p.coins += bet;
                    playersData[p.name].coins = p.coins;
                });
                savePlayersData();
                io.to(room.roomCode).emit('gameOver', { 
                    message: `Match ended early due to insufficient players or coins. Bets refunded.`,
                    players: room.players
                });
            }
            rooms.delete(room.roomCode);
        }
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

    function leaveRoom(socket, username, roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        const playerIdx = room.players.findIndex(p => p.name === username);
        if (playerIdx !== -1) {
            const player = room.players[playerIdx];
            const bet = room.bets.get(player.id) || 0;
            player.coins += bet;
            playersData[player.name].coins = player.coins;
            room.totalPot -= bet;
            room.players.splice(playerIdx, 1);
            room.bets.delete(player.id);
            room.rolls.delete(player.id);
            room.roundWins.delete(player.id);
            if (room.bets.size > 0) {
                room.requiredBet = Math.max(...room.bets.values());
            } else {
                room.requiredBet = 0;
            }
            room.maxBet = room.players.length >= 2 ? Math.min(...room.players.map(p => p.coins)) : Infinity;
            savePlayersData();
            io.to(roomCode).emit('updatePlayers', room.players);
            io.to(roomCode).emit('roomStatus', { 
                canPlay: room.players.length >= 2 && room.players.some(p => p.coins >= room.requiredBet),
                maxBet: room.maxBet,
                gameMode: room.gameMode,
                roundNumber: room.roundNumber,
                roundWins: Object.fromEntries(room.roundWins)
            });
            if (room.players.length < 2) {
                endMatchEarly(room);
            }
            socket.leave(roomCode);
        }
    }

    function normalizeRoomCode(code) {
        return code.trim().toUpperCase();
    }
});

function savePlayersData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(playersData, null, 2));
}

server.listen(process.env.PORT || 3000, () => console.log(`Server on ${process.env.PORT || 3000}`));
