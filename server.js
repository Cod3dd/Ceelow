const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    socket.on('joinRoom', ({ roomCode, username }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: [],
                currentTurn: 0,
                bets: {},
                rolls: {},
                roundActive: false,
                rematchVotes: new Set(),
                turnTimer: null
            };
        }
        let playerName = username && username.trim() ? username.trim() : `Player${rooms[roomCode].players.length + 1}`;
        let player = { id: socket.id, coins: 100, name: playerName };
        rooms[roomCode].players.push(player);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
        socket.emit('joined', { roomCode, player });
    });

    socket.on('placeBet', ({ roomCode, bet }) => {
        let room = rooms[roomCode];
        let player = room.players.find(p => p.id === socket.id);
        if (player.coins >= bet && !room.bets[socket.id]) {
            room.bets[socket.id] = bet;
            player.coins -= bet;
            io.to(roomCode).emit('updatePlayers', room.players);
            io.to(roomCode).emit('message', `${player.name} bet ${bet} coins.`);

            if (Object.keys(room.bets).length === room.players.length && !room.roundActive) {
                room.roundActive = true;
                startTurnTimer(roomCode, 'roll');
                io.to(roomCode).emit('nextTurn', { playerName: room.players[room.currentTurn].name, timeLeft: 30 });
            }
        }
    });

    socket.on('rollDice', (roomCode) => {
        let room = rooms[roomCode];
        let player = room.players[room.currentTurn];
        if (player.id === socket.id && room.roundActive) {
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

            room.rolls[socket.id] = { dice, result, point };
            io.to(roomCode).emit('diceRolled', { player: player.name, dice, result });

            if (result.includes("Win")) {
                handleInstantWin(roomCode, player);
                return;
            } else if (result.includes("Loss")) {
                handleInstantLoss(roomCode);
                return;
            }

            room.currentTurn = (room.currentTurn + 1) % room.players.length;
            if (Object.keys(room.rolls).length === room.players.length) {
                determineWinner(roomCode);
            } else {
                startTurnTimer(roomCode, 'roll');
                io.to(roomCode).emit('nextTurn', { playerName: room.players[room.currentTurn].name, timeLeft: 30 });
            }
        }
    });

    socket.on('voteRematch', (roomCode) => {
        let room = rooms[roomCode];
        room.rematchVotes.add(socket.id);
        io.to(roomCode).emit('message', `${room.players.find(p => p.id === socket.id).name} wants a rematch! (${room.rematchVotes.size}/${room.players.length})`);
        
        if (room.rematchVotes.size === room.players.length) {
            resetRound(roomCode);
            io.to(roomCode).emit('message', 'All players voted for a rematch! Starting new round...');
        }
    });

    socket.on('requestPlayersUpdate', (roomCode) => {
        if (rooms[roomCode]) {
            io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
        }
    });

    socket.on('disconnect', () => {
        for (let roomCode in rooms) {
            let room = rooms[roomCode];
            let player = room.players.find(p => p.id === socket.id);
            if (player) {
                io.to(roomCode).emit('message', `${player.name} has left the table.`);
            }
            room.players = room.players.filter(p => p.id !== socket.id);
            delete room.bets[socket.id];
            delete room.rolls[socket.id];
            room.rematchVotes.delete(socket.id);
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('updatePlayers', room.players);
                if (room.roundActive && room.players.length === Object.keys(room.rolls).length) {
                    determineWinner(roomCode);
                }
            }
        }
    });
});

function rollDice() {
    return [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1
    ];
}

function getCeeloResult(dice) {
    dice.sort((a, b) => a - b);
    let [d1, d2, d3] = dice;
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

function startTurnTimer(roomCode, phase) {
    let room = rooms[roomCode];
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = setTimeout(() => {
        io.to(roomCode).emit('message', `${room.players[room.currentTurn].name} took too long! Skipping turn...`);
        if (phase === 'roll') {
            room.rolls[room.players[room.currentTurn].id] = { dice: [0, 0, 0], result: "Skipped", point: 0 };
            room.currentTurn = (room.currentTurn + 1) % room.players.length;
            if (Object.keys(room.rolls).length === room.players.length) {
                determineWinner(roomCode);
            } else {
                startTurnTimer(roomCode, 'roll');
                io.to(roomCode).emit('nextTurn', { playerName: room.players[room.currentTurn].name, timeLeft: 30 });
            }
        }
    }, 30000);
}

function handleInstantWin(roomCode, winner) {
    let room = rooms[roomCode];
    let pot = Object.values(room.bets).reduce((sum, bet) => sum + bet, 0);
    winner.coins += pot;
    io.to(roomCode).emit('gameOver', {
        message: `${winner.name} rolled 4-5-6 and wins ${pot} coins instantly!`,
        winnerName: winner.name,
        amount: pot
    });
}

function handleInstantLoss(roomCode) {
    let room = rooms[roomCode];
    let pot = Object.values(room.bets).reduce((sum, bet) => sum + bet, 0);
    let winner = room.players.find(p => !room.rolls[p.id] || room.rolls[p.id].point !== -Infinity) || room.players[0];
    winner.coins += pot;
    io.to(roomCode).emit('gameOver', {
        message: `${room.players[room.currentTurn].name} rolled 1-2-3! ${winner.name} wins ${pot} coins by default!`,
        winnerName: winner.name,
        amount: pot
    });
}

function determineWinner(roomCode) {
    let room = rooms[roomCode];
    let pot = Object.values(room.bets).reduce((sum, bet) => sum + bet, 0);
    let highestPoint = -Infinity;
    let winner = null;

    for (let playerId in room.rolls) {
        let roll = room.rolls[playerId];
        if (roll.point >= highestPoint) {
            highestPoint = roll.point;
            winner = room.players.find(p => p.id === playerId);
        }
    }

    if (winner) {
        winner.coins += pot;
        if (highestPoint === 0) {
            io.to(roomCode).emit('gameOver', {
                message: `No points scored! ${winner.name} wins ${pot} coins by default!`,
                winnerName: winner.name,
                amount: pot
            });
        } else {
            io.to(roomCode).emit('gameOver', {
                message: `${winner.name} wins with ${highestPoint} points! Pot: ${pot} coins.`,
                winnerName: winner.name,
                amount: pot
            });
        }
    } else {
        io.to(roomCode).emit('gameOver', {
            message: `No valid rolls! Pot of ${pot} coins is lost.`,
            winnerName: null,
            amount: 0
        });
    }
}

function resetRound(roomCode) {
    let room = rooms[roomCode];
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.bets = {};
    room.rolls = {};
    room.currentTurn = 0;
    room.roundActive = false;
    room.rematchVotes.clear();
    io.to(roomCode).emit('updatePlayers', room.players);
    io.to(roomCode).emit('roundReset');
}

server.listen(3000, () => console.log('Server running on http://localhost:3000'));