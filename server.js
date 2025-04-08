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
    socket.on('joinRoom', ({ roomCode, username }) => {
        socket.join(roomCode);
        if (!rooms.has(roomCode)) rooms.set(roomCode, { players: [], bets: new Map(), rolls: new Map(), turn: 0, active: false });
        const room = rooms.get(roomCode);
        const player = { id: socket.id, name: username || `Player${room.players.length + 1}`, coins: 100 };
        if (room.players.some(p => p.name === player.name)) {
            socket.emit('joinError', 'Username taken');
            return;
        }
        room.players.push(player);
        socket.emit('joined', { roomCode, player });
        io.to(roomCode).emit('updatePlayers', room.players);
        io.to(roomCode).emit('roomStatus', { canPlay: room.players.length >= 2 });
    });

    socket.on('placeBet', ({ roomCode, bet }) => {
        const room = rooms.get(roomCode);
        if (room.players.length < 2 || room.active) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.coins >= bet && !room.bets.has(socket.id)) {
            room.bets.set(socket.id, bet);
            player.coins -= bet;
            io.to(roomCode).emit('updatePlayers', room.players);
            if (room.bets.size === room.players.length) {
                room.active = true;
                io.to(roomCode).emit('nextTurn', { playerName: room.players[0].name });
            }
        }
    });

    socket.on('rollDice', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room.active || room.players.length < 2) return;
        const player = room.players[room.turn];
        if (player.id !== socket.id) return;

        let dice, result, point;
        do {
            dice = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1);
            result = getCeeloResult(dice);
            point = calculatePoint(dice, result);
            if (!isValidResult(result)) {
                io.to(roomCode).emit('diceRolled', { player: player.name, dice, result: `${result} Rerolling...` });
            }
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
                io.to(roomCode).emit('nextTurn', { playerName: room.players[room.turn].name });
            }
        }
    });

    socket.on('disconnect', () => {
        for (const [roomCode, room] of rooms) {
            const playerIdx = room.players.findIndex(p => p.id === socket.id);
            if (playerIdx !== -1) {
                room.players.splice(playerIdx, 1);
                room.bets.delete(socket.id);
                room.rolls.delete(socket.id);
                io.to(roomCode).emit('updatePlayers', room.players);
                io.to(roomCode).emit('roomStatus', { canPlay: room.players.length >= 2 });
                if (room.players.length === 0) rooms.delete(roomCode);
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

    function endRound(roomCode, winner) {
        const room = rooms.get(roomCode);
        const pot = Array.from(room.bets.values()).reduce((a, b) => a + b, 0);
        winner.coins += pot;
        io.to(roomCode).emit('gameOver', { message: `${winner.name} wins ${pot} coins with ${room.rolls.get(winner.id).result}!` });
        room.active = false;
        room.bets.clear();
        room.rolls.clear();
        room.turn = 0;
        io.to(roomCode).emit('roundReset');
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
});

server.listen(process.env.PORT || 3000, () => console.log(`Server on ${process.env.PORT || 3000}`));
