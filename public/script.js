const socket = io(window.location.origin); // Changed from io() to io(window.location.origin)
let roomCode = null;
let myPlayer = null;
let timerInterval = null;

const rollSound = new Audio('https://freesound.org/data/previews/262/262779_4293761-lq.mp3');
const winSound = new Audio('https://freesound.org/data/previews/387/387234_4280995-lq.mp3');

// Show instructions on first load
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('instructions-modal').style.display = 'flex';
});

document.getElementById('instructions-ok').addEventListener('click', () => {
    document.getElementById('instructions-modal').style.display = 'none';
});

document.getElementById('join-btn').addEventListener('click', () => {
    roomCode = document.getElementById('room-code').value;
    const username = document.getElementById('username').value;
    if (roomCode && username) {
        socket.emit('joinRoom', { roomCode, username });
    } else {
        alert('Please enter both an alias and a room code!');
    }
});

socket.on('joined', ({ roomCode: rc, player }) => {
    roomCode = rc;
    myPlayer = player;
    document.getElementById('room-setup').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('player-name').textContent = player.name;
    document.getElementById('coins').textContent = player.coins;
});

socket.on('updatePlayers', (players) => {
    const playersDiv = document.getElementById('players');
    playersDiv.innerHTML = players.map(p => `<p class="${p.name === document.getElementById('turn').textContent.split(': ')[1] ? 'active' : ''}">${p.name} - Balance: ${p.coins}</p>`).join('');
    if (myPlayer) {
        const me = players.find(p => p.id === myPlayer.id);
        if (me) {
            document.getElementById('coins').textContent = me.coins;
        }
    }
});

document.getElementById('bet-btn').addEventListener('click', () => {
    const bet = parseInt(document.getElementById('bet-amount').value);
    if (isNaN(bet) || bet < 1) {
        document.getElementById('result').textContent = 'Bet must be at least 1 coin!';
    } else if (bet > myPlayer.coins) {
        document.getElementById('result').textContent = 'Not enough coins!';
    } else {
        socket.emit('placeBet', { roomCode, bet });
        document.getElementById('bet-btn').disabled = true;
    }
});

document.getElementById('roll-btn').addEventListener('click', () => {
    const diceElements = [
        document.getElementById('die1'),
        document.getElementById('die2'),
        document.getElementById('die3')
    ];
    diceElements.forEach(die => {
        die.textContent = '?';
        die.classList.add('spinning');
    });
    rollSound.play();
    socket.emit('rollDice', roomCode);
});

socket.on('diceRolled', ({ player, dice, result }) => {
    const diceElements = [
        document.getElementById('die1'),
        document.getElementById('die2'),
        document.getElementById('die3')
    ];
    setTimeout(() => {
        diceElements.forEach((die, index) => {
            die.classList.remove('spinning');
            die.textContent = dice[index];
        });
        document.getElementById('result').textContent = `${player}: ${result}`;
        if (result.includes("Rerolling")) {
            setTimeout(() => {
                diceElements.forEach(die => {
                    die.textContent = '?';
                    die.classList.add('spinning');
                });
                rollSound.play();
            }, 500);
        }
    }, 1500);
});

document.getElementById('rematch-btn').addEventListener('click', () => {
    socket.emit('voteRematch', roomCode);
    document.getElementById('rematch-btn').disabled = true;
    document.getElementById('result').textContent = `${myPlayer.name} voted for a rematch...`;
});

document.getElementById('leave-btn').addEventListener('click', () => {
    socket.disconnect();
    document.getElementById('game').style.display = 'none';
    document.getElementById('room-setup').style.display = 'block';
    document.getElementById('username').value = '';
    document.getElementById('room-code').value = '';
});

document.getElementById('modal-ok').addEventListener('click', () => {
    document.getElementById('winner-modal').style.display = 'none';
    document.getElementById('rematch-btn').style.display = 'inline-block';
});

socket.on('nextTurn', ({ playerName, timeLeft }) => {
    document.getElementById('turn').textContent = `Turn: ${playerName}`;
    const rollBtn = document.getElementById('roll-btn');
    rollBtn.disabled = playerName !== myPlayer.name;
    if (timerInterval) clearInterval(timerInterval);
    let time = timeLeft;
    document.getElementById('timer').textContent = `Time Left: ${time}s`;
    timerInterval = setInterval(() => {
        time--;
        document.getElementById('timer').textContent = `Time Left: ${time}s`;
        if (time <= 0) clearInterval(timerInterval);
    }, 1000);
    socket.emit('requestPlayersUpdate', roomCode);
});

socket.on('message', (msg) => {
    const messages = document.getElementById('messages');
    messages.innerHTML += `<p>${msg}</p>`;
    messages.scrollTop = messages.scrollHeight;
});

socket.on('gameOver', ({ message, winnerName, amount }) => {
    document.getElementById('result').textContent = message;
    document.getElementById('turn').textContent = '';
    document.getElementById('timer').textContent = 'Time Left: --';
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('roll-btn').disabled = true;

    if (winnerName) {
        setTimeout(() => {
            document.getElementById('winner-text').textContent = `${winnerName} won ${amount} coins!`;
            document.getElementById('winner-modal').style.display = 'flex';
            winSound.play();
            startRematchTimer();
        }, 3000);
    }
});

socket.on('roundReset', () => {
    document.getElementById('bet-amount').value = '';
    document.getElementById('bet-btn').disabled = false;
    document.getElementById('roll-btn').disabled = true;
    document.getElementById('rematch-btn').style.display = 'none';
    document.getElementById('rematch-btn').disabled = false;
    const dice = [document.getElementById('die1'), document.getElementById('die2'), document.getElementById('die3')];
    dice.forEach(die => {
        die.classList.remove('spinning');
        die.textContent = '-';
    });
    document.getElementById('result').textContent = 'Place your bets for the next round!';
    document.getElementById('timer').textContent = 'Time Left: --';
    if (timerInterval) clearInterval(timerInterval);
});

function startRematchTimer() {
    let time = 10;
    document.getElementById('result').textContent = `Rematch in ${time}s unless all vote...`;
    const rematchInterval = setInterval(() => {
        time--;
        document.getElementById('result').textContent = `Rematch in ${time}s unless all vote...`;
        if (time <= 0) {
            clearInterval(rematchInterval);
            socket.emit('voteRematch', roomCode);
        }
    }, 1000);
    document.getElementById('rematch-btn').addEventListener('click', () => clearInterval(rematchInterval), { once: true });
}
