const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "https://ceelow.onrender.com",
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map(); // Use Map for better performance

function initializeRoom(roomCode) {
    return {
        players: [],
        currentTurn: 0,
        bets: new Map(),
        rolls: new Map(),
        roundActive: false,
        rematchVotes: new Set(),
        turnTimer: null,
        roundCount: 0,
        maxRounds: 1, // Default to single round, configurable later
        wins: new Map() // Track wins for best-of-3
    };
}

io.on('connection', (socket) => {
    console.log(`[Connection] Player connected: ${socket.id}`);

    socket.on('joinRoom', ({ roomCode, username }) => {
        console.log(`[JoinRoom] ${username} joining ${roomCode}, Socket: ${socket.id}`);
        socket.join(roomCode);

        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, initializeRoom(roomCode));
            console.log(`[JoinRoom] Created room: ${roomCode}`);
        }

        const room = rooms.get(roomCode);
        const playerName = username.trim() || `Player${room.players.length + 1}`;
        if (room.players.some(p => p.name === playerName)) {
            socket.emit('joinError', 'Username taken!');
            return;
        }

        const player = { id: socket.id, coins: 100, name: playerName, roundsWon: 0 };
        room.players.push(player);
        socket.emit('joined', { roomCode, player });
        broadcastRoomUpdate(roomCode);
    });

    socket.on('setGameMode', ({ roomCode, bestOf }) => {
        const room = rooms.get(roomCode);
        if (!room || room.roundActive) return;
        room.maxRounds = bestOf === 'bestOf3' ? 3 : 1;
        io.to(roomCode).emit('message', `Game mode set to ${room.maxRounds === 3 ? 'Best of 3' : 'Single Round'}`);
        broadcastRoomUpdate(roomCode);
    });

    socket.on('placeBet', ({ roomCode, bet }) => {
        const room = rooms.get(roomCode);
        if (room.players.length < 2 || room.roundActive) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.coins >= bet && !room.bets.has(socket.id)) {
            room.bets.set(socket.id, bet);
            player.coins -= bet;
            io.to(roomCode).emit('message', `${player.name} bet ${bet} coins`);
            broadcastRoomUpdate(roomCode);
            if (room.bets.size === room.players.length) {
                startRound(roomCode);
            }
        }
    });

    socket.on('rollDice', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room.players.length < 2 || !room.roundActive) return;
        const player = room.players[room.currentTurn];
        if (player.id !== socket.id) return;

        clearTimeout(room.turnTimer);
        let dice, result, point;
        do {
            dice = rollDice();
            result = getCeeloResult(dice);
            point = calculatePoint(dice, result);
            if (!isValidResult(result)) {
                io.to(roomCode).emit('diceRolled', { player: player.name, dice, result: `${result} Rerolling...` });
            }
        } while (!isValidResult(result));

        room.rolls.set(socket.id, { dice, result, point });
        io.to(roomCode).emit('diceRolled', { player: player.name, dice, result });

        if (result.includes("Win")) {
            handleInstantWin(roomCode, player);
        } else if (result.includes("Loss")) {
            handleInstantLoss(roomCode);
        } else {
            nextTurn(roomCode);
        }
    });

    socket.on('voteRematch', (roomCode) => {
        const room = rooms.get(roomCode);
        room.rematchVotes.add(socket.id);
        io.to(roomCode).emit('message', `${room.players.find(p => p.id === socket.id).name} wants a rematch! (${room.rematchVotes.size}/${room.players.length})`);
        if (room.rematchVotes.size === room.players.length) {
            resetRound(roomCode);
            io.to(roomCode).emit('message', 'New round starting...');
        }
    });

    socket.on('chatMessage', ({ roomCode, message }) => {
        io.to(roomCode).emit('message', message);
    });

    socket.on('requestPlayersUpdate', (roomCode) => {
        broadcastRoomUpdate(roomCode);
    });

    socket.on('disconnect', () => {
        console.log(`[Disconnect] Player disconnected: ${socket.id}`);
        for (const [roomCode, room] of rooms) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                io.to(roomCode).emit('message', `${player.name} left the table`);
                room.players = room.players.filter(p => p.id !== socket.id);
                room.bets.delete(socket.id);
                room.rolls.delete(socket.id);
                room.rematchVotes.delete(socket.id);
                room.wins.delete(socket.id);
                if (room.players.length === 0) {
                    rooms.delete(roomCode);
                    console.log(`[Disconnect] Room ${roomCode} deleted`);
                } else {
                    broadcastRoomUpdate(roomCode);
                    if (room.roundActive && room.rolls.size === room.players.length) {
                        determineWinner(roomCode);
                    }
                }
            }
        }
    });
});

function rollDice() {
    return Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1);
}

function getCeeloResult(dice) {
    const sorted = [...dice].sort();
    const [d1, d2, d3] = sorted;
    if (d1 === 4 && d2 === 5 && d3 === 6) return "4-5-6! Instant Win!";
    if (d1 === 1 && d2 === 2 && d3 === 3) return "1-2-3! Instant Loss!";
    if (d1 === d2 && d2 === d3) return `Trips ${d1}! Point: ${d1}`;
    if (d1 === d2) return `Pair ${d1}, Point: ${d3}`;
    if (d2 === d3) return `Pair ${d2}, Point: ${d1}`;
    if (d1 === d3) return `Pair ${d1}, Point: ${d2}`;
    return "Invalid roll";
}

function calculatePoint(dice, result) {
    if (result.includes("Win")) return Infinity;
    if (result.includes("Loss")) return -Infinity;
    if (result.includes("Trips")) return parseInt(result.match(/Trips (\d+)/)[1]);
    if (result.includes("Pair")) return parseInt(result.match(/Point: (\d+)/)[1]);
    return 0;
}

function isValidResult(result) {
    return result.includes("Win") || result.includes("Loss") || result.includes("Trips") || result.includes("Pair");
}

function startRound(roomCode) {
    const room = rooms.get(roomCode);
    room.roundActive = true;
    room.currentTurn = 0;
    startTurnTimer(roomCode);
    io.to(roomCode).emit('nextTurn', { playerName: room.players[0].name, timeLeft: 30 });
}

function nextTurn(roomCode) {
    const room = rooms.get(roomCode);
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    if (room.rolls.size === room.players.length) {
        determineWinner(roomCode);
    } else {
        startTurnTimer(roomCode);
        io.to(roomCode).emit('nextTurn', { playerName: room.players[room.currentTurn].name, timeLeft: 30 });
    }
}

function startTurnTimer(roomCode) {
    const room = rooms.get(roomCode);
    clearTimeout(room.turnTimer);
    room.turnTimer = setTimeout(() => {
        const player = room.players[room.currentTurn];
        io.to(roomCode).emit('message', `${player.name} took too long! Skipping...`);
        room.rolls.set(player.id, { dice: [0, 0, 0], result: "Skipped", point: 0 });
        nextTurn(roomCode);
    }, 30000);
}

function handleInstantWin(roomCode, winner) {
    const room = rooms.get(roomCode);
    endRound(roomCode, winner);
}

function handleInstantLoss(roomCode) {
    const room = rooms.get(roomCode);
    const winner = room.players.find(p => !room.rolls.get(p.id)?.result.includes("Loss")) || room.players[0];
    endRound(roomCode, winner);
}

function determineWinner(roomCode) {
    const room = rooms.get(roomCode);
    let highestPoint = -Infinity;
    let winner = null;
    for (const [id, roll] of room.rolls) {
        if (roll.point > highestPoint) {
            highestPoint = roll.point;
            winner = room.players.find(p => p.id === id);
        }
    }
    endRound(roomCode, winner || room.players[0]);
}

function endRound(roomCode, winner) {
    const room = rooms.get(roomCode);
    const pot = Array.from(room.bets.values()).reduce((sum, bet) => sum + bet, 0);
    winner.coins += pot;
    room.wins.set(winner.id, (room.wins.get(winner.id) || 0) + 1);
    room.roundCount++;
    
    io.to(roomCode).emit('gameOver', {
        message: `${winner.name} wins this round with ${pot} coins!`,
        winnerName: winner.name,
        amount: pot,
        roundCount: room.roundCount,
        maxRounds: room.maxRounds,
        wins: Object.fromEntries(room.wins)
    });

    if (room.roundCount >= room.maxRounds) {
        const overallWinner = Array.from(room.wins.entries())
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        const winnerPlayer = room.players.find(p => p.id === overallWinner);
        io.to(roomCode).emit('matchOver', {
            message: `${winnerPlayer.name} wins the match with ${room.wins.get(overallWinner)} rounds!`,
            winnerName: winnerPlayer.name
        });
        resetMatch(roomCode);
    } else {
        resetRound(roomCode);
    }
}

function resetRound(roomCode) {
    const room = rooms.get(roomCode);
    clearTimeout(room.turnTimer);
    room.bets.clear();
    room.rolls.clear();
    room.currentTurn = 0;
    room.roundActive = false;
    room.rematchVotes.clear();
    io.to(roomCode).emit('roundReset');
    broadcastRoomUpdate(roomCode);
}

function resetMatch(roomCode) {
    const room = rooms.get(roomCode);
    clearTimeout(room.turnTimer);
    room.bets.clear();
    room.rolls.clear();
    room.currentTurn = 0;
    room.roundActive = false;
    room.rematchVotes.clear();
    room.roundCount = 0;
    room.wins.clear();
    io.to(roomCode).emit('matchReset');
    broadcastRoomUpdate(roomCode);
}

function broadcastRoomUpdate(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    io.to(roomCode).emit('updatePlayers', room.players);
    io.to(roomCode).emit('roomStatus', { canPlay: room.players.length >= 2 });
}

server.listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));
