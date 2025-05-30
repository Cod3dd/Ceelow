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

document.getElementById('create-room-btn').addEventListener('click', () => {
    if (!myUsername) return alert('Log in first');
    const gameMode = document.getElementById('game-mode').value;
    document.getElementById('create-room-btn').disabled = true;
    socket.emit('createRoom', { username: myUsername, gameMode });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
    if (!myUsername) return alert('Log in first');
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
    if (!roomCode) return alert('Enter a room code');
    document.getElementById('join-room-btn').disabled = true;
    socket.emit('joinRoom', { username: myUsername, roomCode });
});

document.getElementById('join-lobby-btn').addEventListener('click', () => {
    if (!myUsername) return alert('Log in first');
    document.getElementById('join-lobby-btn').disabled = true;
    socket.emit('joinRoom', { username: myUsername });
});

document.getElementById('bet-btn').addEventListener('click', () => {
    const bet = parseInt(document.getElementById('bet-amount').value);
    if (isNaN(bet) || bet <= 0 || bet > parseInt(document.getElementById('coins').textContent)) return updateResult('Invalid bet');
    socket.emit('placeBet', { username: myUsername, bet });
    document.getElementById('bet-btn').disabled = true;
});

document.getElementById('match-btn').addEventListener('click', () => {
    const bet = parseInt(document.getElementById('match-amount').value);
    if (isNaN(bet) || bet <= 0 || bet > parseInt(document.getElementById('coins').textContent)) return updateResult('Invalid match amount');
    socket.emit('matchBet', { username: myUsername, bet });
    document.getElementById('match-btn').disabled = true;
});

document.getElementById('leave-match-btn').addEventListener('click', () => {
    socket.emit('leaveRoom', { username: myUsername });
    resetUI();
});

document.getElementById('roll-btn').addEventListener('click', () => {
    socket.emit('rollDice', { username: myUsername });
});

document.getElementById('leave-btn').addEventListener('click', () => {
    socket.emit('leaveRoom', { username: myUsername });
    socket.close();
    resetUI();
    socket.connect();
});

document.getElementById('chat-btn').addEventListener('click', () => {
    const message = document.getElementById('chat-input').value.trim();
    if (!message) return;
    socket.emit('sendChat', { username: myUsername, message });
    document.getElementById('chat-input').value = '';
});

socket.on('accountCreated', ({ username, coins }) => {
    myUsername = username;
    document.getElementById('create-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('room-selection').style.display = 'block';
    document.getElementById('player-name').textContent = username || 'Unknown';
    document.getElementById('coins').textContent = coins !== undefined ? coins : 0;
    document.getElementById('create-btn').disabled = false;
});

socket.on('accountError', (msg) => {
    document.getElementById('create-btn').disabled = false;
    alert(msg);
});

socket.on('loginSuccess', ({ username, coins }) => {
    myUsername = username;
    document.getElementById('create-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('room-selection').style.display = 'block';
    document.getElementById('player-name').textContent = username || 'Unknown';
    document.getElementById('coins').textContent = coins !== undefined ? coins : 0;
    document.getElementById('login-btn').disabled = false;
});

socket.on('loginError', (msg) => {
    document.getElementById('login-btn').disabled = false;
    alert(msg);
});

socket.on('roomCreated', ({ roomCode, gameMode }) => {
    document.getElementById('room-code-display').textContent = `Room Code: ${roomCode.trim()} (${gameMode.toUpperCase()})`;
    document.getElementById('create-room-btn').disabled = false;
});

socket.on('joinError', (msg) => {
    document.getElementById('join-room-btn').disabled = false;
    document.getElementById('join-lobby-btn').disabled = false;
    document.getElementById('create-room-btn').disabled = false;
    alert(msg);
});

socket.on('joined', ({ player, roomCode, gameMode, chatMessages }) => {
    document.getElementById('room-selection').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('coins').textContent = player.coins !== undefined ? player.coins : 0;
    document.getElementById('player-name').textContent = player.name || 'Unknown';
    document.getElementById('room-info').textContent = roomCode === 'lobby' ? 'Public Lobby (Single)' : `Room: ${roomCode} (${gameMode.toUpperCase()})`;
    document.getElementById('join-room-btn').disabled = false;
    document.getElementById('join-lobby-btn').disabled = false;
    chatMessages.forEach(msg => appendChatMessage(msg));
});

socket.on('updatePlayers', (players) => {
    document.getElementById('players').innerHTML = players.map(p => `<p>${p.name} - ${p.coins}</p>`).join('');
    const me = players.find(p => p.name === myUsername);
    if (me) {
        document.getElementById('coins').textContent = me.coins !== undefined ? me.coins : 0;
        document.getElementById('player-name').textContent = me.name || 'Unknown';
    }
});

socket.on('roomStatus', ({ canPlay, maxBet, gameMode, roundNumber, roundWins }) => {
    document.getElementById('bet-btn').disabled = !canPlay;
    document.getElementById('roll-btn').disabled = !canPlay;
    document.getElementById('bet-amount').max = maxBet;
    document.getElementById('game-status').textContent = `Mode: ${gameMode.toUpperCase()} | Round: ${roundNumber} | Wins: ${Object.entries(roundWins).map(([id, wins]) => `${players.find(p => p.id === id)?.name || 'Unknown'}: ${wins}`).join(', ')}`;
    updateResult(canPlay ? `Place your bets! (Max: ${maxBet})` : 'Waiting for another player or coins...');
});

socket.on('betPlaced', ({ username, bet, requiredBet, totalPot }) => {
    updateResult(`${username} bets ${bet}. All bets must be ${requiredBet}. Pot: ${totalPot}`);
});

socket.on('betError', (msg) => {
    document.getElementById('bet-btn').disabled = false;
    updateResult(msg);
});

socket.on('matchBet', ({ requiredBet }) => {
    document.getElementById('bet-form').style.display = 'none';
    document.getElementById('match-form').style.display = 'block';
    document.getElementById('match-amount').value = requiredBet;
    document.getElementById('match-amount').min = requiredBet;
    document.getElementById('match-amount').max = requiredBet;
    updateResult(`Match ${requiredBet} or leave`);
});

socket.on('nextTurn', ({ playerName }) => {
    document.getElementById('turn').textContent = `Turn: ${playerName}`;
    document.getElementById('roll-btn').disabled = playerName !== myUsername;
});

socket.on('diceRolled', ({ player, dice, result }) => {
    ['die1', 'die2', 'die3'].forEach((id, i) => document.getElementById(id).textContent = dice[i]);
    updateResult(`${player}: ${result}`);
});

socket.on('roundOver', ({ message, roundWins }) => {
    updateResult(message);
    document.getElementById('game-status').textContent = `Wins: ${Object.entries(roundWins).map(([id, wins]) => `${players.find(p => p.id === id)?.name || 'Unknown'}: ${wins}`).join(', ')}`;
    document.getElementById('turn').textContent = '';
    document.getElementById('roll-btn').disabled = true;
});

socket.on('gameOver', ({ message, players }) => {
    updateResult(message);
    document.getElementById('turn').textContent = '';
    document.getElementById('roll-btn').disabled = true;
    document.getElementById('players').innerHTML = players.map(p => `<p>${p.name} - ${p.coins}</p>`).join('');
    const me = players.find(p => p.name === myUsername);
    if (me) {
        document.getElementById('coins').textContent = me.coins !== undefined ? me.coins : 0;
        document.getElementById('player-name').textContent = me.name || 'Unknown';
    }
    resetUI();
});

socket.on('roundReset', () => {
    document.getElementById('bet-amount').value = '';
    document.getElementById('bet-form').style.display = 'block';
    document.getElementById('match-form').style.display = 'none';
    document.getElementById('bet-btn').disabled = false;
    document.getElementById('roll-btn').disabled = true;
    ['die1', 'die2', 'die3'].forEach(id => document.getElementById(id).textContent = '-');
    document.getElementById('match-amount').value = '';
    document.getElementById('match-btn').disabled = false;
    document.getElementById('turn').textContent = '';
    updateResult('Place your bets!');
});

socket.on('receiveChat', (msg) => {
    appendChatMessage(msg);
});

function appendChatMessage({ username, message, timestamp }) {
    const chatLog = document.getElementById('chat-log');
    const msgElement = document.createElement('p');
    msgElement.textContent = `[${new Date(timestamp).toLocaleTimeString()}] ${username}: ${message}`;
    chatLog.appendChild(msgElement);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function updateResult(message) {
    document.getElementById('result').textContent = message;
}

function resetUI() {
    document.getElementById('game').style.display = 'none';
    document.getElementById('room-selection').style.display = 'block';
    document.getElementById('create-form').style.display = 'none';
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
    document.getElementById('match-amount').value = '';
    document.getElementById('match-form').style.display = 'none';
    document.getElementById('bet-form').style.display = 'block';
    document.getElementById('chat-log').innerHTML = '';
    document.getElementById('chat-input').value = '';
    document.getElementById('room-code').value = '';
    document.getElementById('room-info').textContent = '';
    document.getElementById('game-status').textContent = '';
    updateResult('');
    document.getElementById('turn').textContent = '';
}
