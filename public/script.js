const socket = io(window.location.origin);
let roomCode = null;
let myPlayer = null;

document.getElementById('join-btn').addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    roomCode = document.getElementById('room-code').value.trim();
    if (!username || !roomCode) return alert('Enter username and room code');
    document.getElementById('join-btn').disabled = true;
    socket.emit('joinRoom', { roomCode, username });
});

document.getElementById('bet-btn').addEventListener('click', () => {
    const bet = parseInt(document.getElementById('bet-amount').value);
    if (isNaN(bet) || bet <= 0 || bet > myPlayer.coins) return updateResult('Invalid bet');
    socket.emit('placeBet', { roomCode, bet });
    document.getElementById('bet-btn').disabled = true;
});

document.getElementById('roll-btn').addEventListener('click', () => {
    socket.emit('rollDice', roomCode);
});

document.getElementById('leave-btn').addEventListener('click', () => {
    socket.close();
    resetUI();
    socket.connect();
});

socket.on('joined', ({ roomCode: rc, player }) => {
    roomCode = rc;
    myPlayer = player;
    document.getElementById('room-setup').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('player-name').textContent = player.name;
    document.getElementById('coins').textContent = player.coins;
    document.getElementById('join-btn').disabled = false;
});

socket.on('joinError', (msg) => {
    document.getElementById('join-btn').disabled = false;
    alert(msg);
});

socket.on('updatePlayers', (players) => {
    document.getElementById('players').innerHTML = players.map(p => `<p>${p.name} - ${p.coins}</p>`).join('');
    if (myPlayer) {
        const me = players.find(p => p.id === myPlayer.id);
        if (me) document.getElementById('coins').textContent = me.coins;
    }
});

socket.on('roomStatus', ({ canPlay }) => {
    document.getElementById('bet-btn').disabled = !canPlay;
    document.getElementById('roll-btn').disabled = !canPlay;
    updateResult(canPlay ? 'Place your bets!' : 'Waiting for another player...');
});

socket.on('nextTurn', ({ playerName }) => {
    document.getElementById('turn').textContent = `Turn: ${playerName}`;
    document.getElementById('roll-btn').disabled = playerName !== myPlayer.name;
});

socket.on('diceRolled', ({ player, dice, result }) => {
    setTimeout(() => {
        ['die1', 'die2', 'die3'].forEach((id, i) => document.getElementById(id).textContent = dice[i]);
        updateResult(`${player}: ${result}`);
    }, result.includes("Rerolling") ? 1500 : 0);
});

socket.on('gameOver', ({ message }) => {
    updateResult(message);
    document.getElementById('turn').textContent = '';
    document.getElementById('roll-btn').disabled = true;
});

socket.on('roundReset', () => {
    document.getElementById('bet-amount').value = '';
    document.getElementById('bet-btn').disabled = !roomCode || rooms.get(roomCode)?.players.length < 2;
    document.getElementById('roll-btn').disabled = true;
    ['die1', 'die2', 'die3'].forEach(id => document.getElementById(id).textContent = '-');
    updateResult('Place your bets!');
    document.getElementById('turn').textContent = '';
});

function updateResult(message) {
    document.getElementById('result').textContent = message;
}

function resetUI() {
    document.getElementById('game').style.display = 'none';
    document.getElementById('room-setup').style.display = 'block';
    document.getElementById('username').value = '';
    document.getElementById('room-code').value = '';
    document.getElementById('player-name').textContent = '';
    document.getElementById('coins').textContent = '';
    document.getElementById('players').innerHTML = '';
    document.getElementById('bet-amount').value = '';
    document.getElementById('bet-btn').disabled = true;
    document.getElementById('roll-btn').disabled = true;
    ['die1', 'die2', 'die3'].forEach(id => document.getElementById(id).textContent = '-');
    updateResult('');
    document.getElementById('turn').textContent = '';
    roomCode = null;
    myPlayer = null;
}
