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
        const dice = [1, 2, 3].map(() => Math.floor(Math.random() * 6) + 1);
        const result = dice.join('-'); // Placeholder scoring
        room.rolls.set(socket.id, { dice, result });
        io.to(roomCode).emit('diceRolled', { player: player.name, dice, result });
        room.turn = (room.turn + 1) % room.players.length;
        if (room.rolls.size === room.players.length) {
            const pot = Array.from(room.bets.values()).reduce((a, b) => a + b, 0);
            const winner = room.players[0]; // First player wins for simplicity
            winner.coins += pot;
            io.to(roomCode).emit('gameOver', { message: `${winner.name} wins ${pot} coins!` });
            room.active = false;
            room.bets.clear();
            room.rolls.clear();
            io.to(roomCode).emit('roundReset');
        } else {
            io.to(roomCode).emit('nextTurn', { playerName: room.players[room.turn].name });
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
});

server.listen(process.env.PORT || 3000, () => console.log(`Server on ${process.env.PORT || 3000}`));
