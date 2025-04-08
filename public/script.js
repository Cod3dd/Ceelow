class CeeloGame {
    constructor() {
        this.socket = io(window.location.origin);
        this.roomCode = null;
        this.myPlayer = null;
        this.timerInterval = null;
        this.canPlay = false;
        this.rollSound = new Audio('https://freesound.org/data/previews/262/262779_4293761-lq.mp3');
        this.winSound = new Audio('https://freesound.org/data/previews/387/387234_4280995-lq.mp3');
        this.setupUI();
        this.setupSocketListeners();
    }

    setupUI() {
        document.getElementById('join-btn').addEventListener('click', () => {
            const roomCode = document.getElementById('room-code').value.trim();
            const username = document.getElementById('username').value.trim();
            if (!roomCode || !username) return alert('Enter room code and username');
            this.roomCode = roomCode;
            document.getElementById('join-btn').disabled = true;
            this.socket.emit('joinRoom', { roomCode, username });
        });

        document.getElementById('bet-btn').addEventListener('click', () => {
            if (!this.canPlay) return this.updateResult('Wait for another player!');
            const bet = parseInt(document.getElementById('bet-amount').value);
            if (isNaN(bet) || bet <= 0) return this.updateResult('Invalid bet');
            if (bet > this.myPlayer.coins) return this.updateResult('Not enough coins');
            this.socket.emit('placeBet', { roomCode: this.roomCode, bet });
            document.getElementById('bet-btn').disabled = true;
        });

        document.getElementById('roll-btn').addEventListener('click', () => {
            if (!this.canPlay) return this.updateResult('Wait for another player!');
            ['die1', 'die2', 'die3'].forEach(id => {
                const die = document.getElementById(id);
                die.textContent = '?';
                die.classList.add('spinning');
            });
            this.rollSound.play();
            this.socket.emit('rollDice', this.roomCode);
        });

        document.getElementById('leave-btn').addEventListener('click', () => {
            this.socket.close();
            this.resetUI();
            this.socket = io(window.location.origin);
            this.setupSocketListeners();
        });

        document.getElementById('send-chat').addEventListener('click', () => {
            const message = document.getElementById('chat-input').value.trim();
            if (message && this.roomCode) {
                this.socket.emit('chatMessage', { roomCode: this.roomCode, message: `${this.myPlayer.name}: ${message}` });
                document.getElementById('chat-input').value = '';
            }
        });

        document.getElementById('game-mode').addEventListener('change', () => {
            const maxRounds = parseInt(document.getElementById('game-mode').value);
            this.socket.emit('setGameMode', { roomCode: this.roomCode, maxRounds });
        });
    }

    setupSocketListeners() {
        this.socket.on('joined', ({ roomCode, player }) => {
            this.roomCode = roomCode;
            this.myPlayer = player;
            document.getElementById('room-setup').style.display = 'none';
            document.getElementById('game').style.display = 'block';
            document.getElementById('player-name').textContent = player.name;
            document.getElementById('coins').textContent = player.coins;
            document.getElementById('join-btn').disabled = false;
            this.socket.emit('requestPlayersUpdate', this.roomCode);
        });

        this.socket.on('joinError', (msg) => {
            document.getElementById('join-btn').disabled = false;
            alert(msg);
        });

        this.socket.on('updatePlayers', (players) => {
            const turn = document.getElementById('turn').textContent.split(': ')[1] || '';
            document.getElementById('players').innerHTML = players.map(p => 
                `<p class="${p.name === turn ? 'active' : ''}">${p.name} - ${p.coins}${p.wins ? ` (${p.wins} wins)` : ''}</p>`
            ).join('');
            if (this.myPlayer) {
                const me = players.find(p => p.id === this.myPlayer.id);
                if (me) document.getElementById('coins').textContent = me.coins;
            }
        });

        this.socket.on('roomStatus', ({ canPlay }) => {
            this.canPlay = canPlay;
            document.getElementById('bet-btn').disabled = !canPlay;
            document.getElementById('roll-btn').disabled = !canPlay || (document.getElementById('turn').textContent && document.getElementById('turn').textContent.split(': ')[1] !== this.myPlayer.name);
            this.updateResult(canPlay ? 'Place your bets!' : 'Waiting for another player...');
        });

        this.socket.on('message', (msg) => {
            document.getElementById('messages').innerHTML += `<p>${msg}</p>`;
            document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        });

        this.socket.on('diceRolled', ({ player, dice, result }) => {
            setTimeout(() => {
                ['die1', 'die2', 'die3'].forEach((id, i) => {
                    const die = document.getElementById(id);
                    die.classList.remove('spinning');
                    die.textContent = dice[i];
                });
                this.updateResult(`${player}: ${result}`);
                if (result.includes("Rerolling")) {
                    setTimeout(() => {
                        ['die1', 'die2', 'die3'].forEach(id => {
                            const die = document.getElementById(id);
                            die.textContent = '?';
                            die.classList.add('spinning');
                        });
                        this.rollSound.play();
                    }, 500);
                }
            }, 1500);
        });

        this.socket.on('nextTurn', ({ playerName, timeLeft }) => {
            document.getElementById('turn').textContent = `Turn: ${playerName}`;
            document.getElementById('roll-btn').disabled = !this.canPlay || playerName !== this.myPlayer.name;
            if (this.timerInterval) clearInterval(this.timerInterval);
            let time = timeLeft;
            document.getElementById('timer').textContent = `Time Left: ${time}s`;
            this.timerInterval = setInterval(() => {
                time--;
                document.getElementById('timer').textContent = `Time Left: ${time}s`;
                if (time <= 0) clearInterval(this.timerInterval);
            }, 1000);
        });

        this.socket.on('gameOver', ({ message, rounds, maxRounds }) => {
            this.updateResult(`${message} (Round ${rounds}/${maxRounds})`);
            document.getElementById('turn').textContent = '';
            if (this.timerInterval) clearInterval(this.timerInterval);
            document.getElementById('timer').textContent = 'Time Left: --';
            document.getElementById('roll-btn').disabled = true;
        });

        this.socket.on('matchOver', ({ message }) => {
            this.updateResult(message);
            document.getElementById('bet-btn').disabled = true;
        });

        this.socket.on('roundReset', () => {
            document.getElementById('bet-amount').value = '';
            document.getElementById('bet-btn').disabled = !this.canPlay;
            document.getElementById('roll-btn').disabled = true;
            ['die1', 'die2', 'die3'].forEach(id => {
                const die = document.getElementById(id);
                die.classList.remove('spinning');
                die.textContent = '-';
            });
            this.updateResult(this.canPlay ? 'Place your bets!' : 'Waiting for another player...');
            document.getElementById('turn').textContent = '';
            if (this.timerInterval) clearInterval(this.timerInterval);
            document.getElementById('timer').textContent = 'Time Left: --';
        });

        this.socket.on('matchReset', () => {
            this.socket.on('roundReset')();
        });
    }

    updateResult(message) {
        document.getElementById('result').textContent = message;
    }

    resetUI() {
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
        ['die1', 'die2', 'die3'].forEach(id => {
            document.getElementById(id).classList.remove('spinning');
            document.getElementById(id).textContent = '-';
        });
        this.updateResult('');
        document.getElementById('turn').textContent = '';
        document.getElementById('timer').textContent = 'Time Left: --';
        document.getElementById('messages').innerHTML = '';
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.roomCode = null;
        this.myPlayer = null;
        this.canPlay = false;
    }
}

new CeeloGame();
