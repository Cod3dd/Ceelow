const socket = io(window.location.origin);
let myUsername = null;

document.getElementById('create-btn').addEventListener('click', () => {
    const username = document.getElementById('create-username').value.trim();
    const password = document.getElementById('create-password').value.trim();
    if (!username || !password) return alert('Enter username and password');
    document.getElementById('create-btn').disabled = true;
    socket.emit('createAccount', { username, password });
});

document.getElementById('login-btn').addEventListener('click', () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) return alert('Enter username and password');
    document.getElementById('login-btn').disabled = true;
    socket.emit('login', { username, password });
});

document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('create-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
});

document.getElementById('show-create').addEventListener('click', () => {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('create-form').style.display = 'block';
});

document.getElementById('join-btn').addEventListener('click', () => {
    if (!myUsername) return alert('Log in first');
    document.getElementById('join-btn').disabled = true;
    socket.emit('joinRoom', { username: myUsername });
});

document.getElementById('bet-btn').addEventListener('click', () => {
    const bet = parseInt(document.getElementById('bet-amount').value);
    if (isNaN(bet) || bet <= 0 || bet > parseInt(document.getElementById('coins').textContent)) return updateResult('Invalid bet');
    socket.emit('placeBet', { username: myUsername, bet });
    document.getElementById('bet-btn').disabled = true;
});

document.getElementById('roll-btn').addEventListener('click', () => {
    socket.emit('rollDice', { username: myUsername });
});

document.getElementById('leave-btn').addEventListener('click', () => {
    socket.close();
    resetUI();
    socket.connect();
});

socket.on('accountCreated', ({ username, coins }) => {
    myUsername = username;
    document.getElementById('create-form').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('player-name').textContent = username;
    document.getElementById('coins').textContent = coins;
    document.getElementById('create-btn').disabled = false;
});

socket.on('accountError', (msg) => {
    document.getElementById('create-btn').disabled = false;
    alert(msg);
});

socket.on('loginSuccess', ({ username, coins }) => {
    myUsername = username;
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('player-name').textContent = username;
    document.getElementById('coins').textContent = coins;
    document.getElementById('login-btn').disabled = false;
});

socket.on('loginError', (msg) => {
    document.getElementById('login-btn').disabled = false;
    alert(msg);
});

socket.on('joined', ({ player }) => {
    document.getElementById('coins').textContent = player.coins;
    document.getElementById('join-btn').disabled = false;
});

socket.on('updatePlayers', (players) => {
    document.getElementById('players').innerHTML = players.map(p => `<p>${p.name} - ${p.coins}</p>`).join('');
    const me = players.find(p => p.name === myUsername);
    if (me) document.getElementById('coins').textContent = me.coins;
});

socket.on('roomStatus', ({ canPlay }) => {
    document.getElementById('bet-btn').disabled = !canPlay;
    document.getElementById('roll-btn').disabled = !canPlay;
    updateResult(canPlay ? 'Place your bets!' : 'Waiting for another player...');
});

socket.on('nextTurn', ({ playerName }) => {
    document.getElementById('turn').textContent = `Turn: ${playerName}`;
    document.getElementById('roll-btn').disabled = playerName !== myUsername;
});

socket.on('diceRolled', ({ player, dice, result }) => {
    ['die1', 'die2', 'die3'].forEach((id, i) => document.getElementById(id).textContent = dice[i]);
    updateResult(`${player}: ${result}`);
});

socket.on('gameOver', ({ message }) => {
    updateResult(message);
    document.getElementById('turn').textContent = '';
    document.getElementById('roll-btn').disabled = true;
});

socket.on('roundReset', () => {
    document.getElementById('bet-amount').value = '';
    document.getElementById('bet-btn').disabled = false;
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
    document.getElementById('create-form').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('create-username').value = '';
    document.getElementById('create-password').value = '';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('player-name').textContent = '';
    document.getElementById('coins').textContent = '';
    document.getElementById('players').innerHTML = '';
    document.getElementById('bet-amount').value = '';
    document.getElementById('bet-btn').disabled = true;
    document.getElementById('roll-btn').disabled = true;
    ['die1', 'die2', 'die3'].forEach(id => document.getElementById(id).textContent = '-');
    updateResult('');
    document.getElementById('turn').textContent = '';
    myUsername = null;
}
