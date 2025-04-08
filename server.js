const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "https://ceelow.onrender.com", methods: ["GET", "POST"], credentials: true }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`[Connection] ${socket.id}`);

    socket.on('joinRoom', ({ roomCode, username }) => {
        console.log(`[JoinRoom] ${username} -> ${roomCode}`);
        socket.join(roomCode);
        if (!rooms.has(roomCode)) rooms.set(roomCode, { 
            players: [], 
            bets: new Map(), 
            rolls: new Map(), 
            turn: 0, 
            active: false, 
            rounds: 0, 
            maxRounds: 1, 
            wins: new Map(), 
            timer: null 
        });
        const room = rooms.get(roomCode);
        const player = { id: socket.id, name: username || `Player${room.players.length + 1}`, coins: 100, wins: 0 };
        if (room.players.some(p => p.name === player.name)) {
            socket.emit('joinError', 'Username taken');
            return;
        }
        room.players.push(player);
        socket.emit('joined', { roomCode, player });
        broadcastRoomUpdate(roomCode);
    });

    socket.on('setGameMode', ({ roomCode, maxRounds }) => {
        const room = rooms.get(roomCode);
        if (!room || room.active) return;
        room.maxRounds = maxRounds;
        io.to(roomCode).emit('message', `Game set to ${maxRounds === 1 ? 'Single Round' : `Best of ${maxRounds}`}`);
        broadcastRoomUpdate(roomCode);
    });

    socket.on('placeBet', ({ roomCode, bet }) => {
        const room = rooms.get(roomCode);
        if (room.players.length < 2 || room.active) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.coins >= bet && !room.bets.has(socket.id)) {
            room.bets.set(socket.id, bet);
            player.coins -= bet;
            io.to(roomCode).emit('message', `${player.name} bet ${bet}`);
            broadcastRoomUpdate(roomCode);
            if (room.bets.size === room.players.length) {
                room.active = true;
                startTurn(roomCode);
            }
        }
    });

    socket.on('rollDice', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room.active || room.players.length < 2) return;
        const player = room.players[room.turn];
        if (player.id !== socket.id) return;

        clearTimeout(room.timer);
        let dice, result, point;
        do {
            dice = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1);
            result = getCeeloResult(dice);
            point = calculatePoint(dice, result);
            if (!isValidResult(result)) io.to(roomCode).emit('diceRolled', { player: player.name, dice, result: `${result} Rerolling...` });
        } while (!isValidResult(result));

        room.rolls.set(socket.id, { dice, result, point });
        io.to(roomCode).emit('diceRolled', { player: player.name, dice, result });

        if (result.includes("Win")) {
            endRound(roomCode, player);
        } else if (result.includes("Loss")) {
            const winner = room.players.find(p => p.id !== socket.id) || room.players[0];
            endRound(roomCode, winner);
        } else {
            room.turn = (room.turn + 1) % room.players.length;
            if (room.rolls.size === room.players.length) {
                determineWinner(roomCode);
            } else {
                startTurn(roomCode);
            }
        }
    });

    socket.on('chatMessage', ({ roomCode, message }) => {
        io.to(roomCode).emit('message', message);
    });

    socket.on('requestPlayersUpdate', (roomCode) => {
        broadcastRoomUpdate(roomCode);
    });

    socket.on('disconnect', () => {
        for (const [roomCode, room] of rooms) {
            const playerIdx = room.players.findIndex(p => p.id === socket.id);
            if (playerIdx !== -1) {
                const player = room.players[playerIdx];
                io.to(roomCode).emit('message', `${player.name} left`);
                room.players.splice(playerIdx, 1);
                room.bets.delete(socket.id);
                room.rolls.delete(socket.id);
                room.wins.delete(socket.id);
                clearTimeout(room.timer);
                broadcastRoomUpdate(roomCode);
                if (room.players.length === 0) rooms.delete(roomCode);
                else if (room.active && room.rolls.size === room.players.length) determineWinner(roomCode);
            }
        }
    });

    function getCeeloResult(dice) {
        const sorted = [...dice].sort();
        const [d1, d2, d3] = sorted;
        if (d1 === 4 && d2 === 5 && d3 === 6) return "4-5-6! Win!";
        if (d1 === 1 && d2 === 2 && d3 === 3) return "1-2-3! Loss!";
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

    function startTurn(roomCode) {
        const room = rooms.get(roomCode);
        room.timer = setTimeout(() => {
            const player = room.players[room.turn];
            io.to(roomCode).emit('message', `${player.name} timed out`);
            room.rolls.set(player.id, { dice: [0, 0, 0], result: "Skipped", point: 0 });
            room.turn = (room.turn + 1) % room.players.length;
            if (room.rolls.size === room.players.length) determineWinner(roomCode);
            else startTurn(roomCode);
        }, 30000);
        io.to(roomCode).emit('nextTurn', { playerName: room.players[room.turn].name, timeLeft: 30 });
    }

    function endRound(roomCode, winner) {
        const room = rooms.get(roomCode);
        const pot = Array.from(room.bets.values()).reduce((a, b) => a + b, 0);
        winner.coins += pot;
        room.wins.set(winner.id, (room.wins.get(winner.id) || 0) + 1);
        room.rounds++;
        io.to(roomCode).emit('gameOver', { 
            message: `${winner.name} wins ${pot} coins!`, 
            winnerName: winner.name, 
            amount: pot, 
            rounds: room.rounds, 
            maxRounds: room.maxRounds, 
            wins: Object.fromEntries(room.wins) 
        });
        if (room.rounds >= room.maxRounds) {
            const overallWinner = Array.from(room.wins.entries()).reduce((a, b) => a[1] > b[1] ? a : b)[0];
            const winnerPlayer = room.players.find(p => p.id === overallWinner);
            io.to(roomCode).emit('matchOver', { message: `${winnerPlayer.name} wins the match!`, winnerName: winnerPlayer.name });
            resetMatch(roomCode);
        } else {
            resetRound(roomCode);
        }
    }

    function determineWinner(roomCode) {
        const room = rooms.get(roomCode);
        let highest = -Infinity;
        let winner = null;
        for (const [id, roll] of room.rolls) {
            if (roll.point > highest) {
                highest = roll.point;
                winner = room.players.find(p => p.id === id);
            }
        }
        endRound(roomCode, winner || room.players[0]);
    }

    function resetRound(roomCode) {
        const room = rooms.get(roomCode);
        clearTimeout(room.timer);
        room.bets.clear();
        room.rolls.clear();
        room.turn = 0;
        room.active = false;
        io.to(roomCode).emit('roundReset');
        broadcastRoomUpdate(roomCode);
    }

    function resetMatch(roomCode) {
        const room = rooms.get(roomCode);
        clearTimeout(room.timer);
        room.bets.clear();
        room.rolls.clear();
        room.turn = 0;
        room.active = false;
        room.rounds = 0;
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
});

server.listen(process.env.PORT || 3000, () => console.log(`Server on ${process.env.PORT || 3000}`));
