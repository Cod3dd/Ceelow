class CeeloGame {
    constructor() {
        this.socket = io(window.location.origin);
        this.roomCode = null;
        this.myPlayer = null;
        this.timerInterval = null;
        this.canPlay = false;
        this.rollSound = new Audio('https://freesound.org/data/previews/262/262779_4293761-lq.mp3');
        this.winSound = new Audio('https://freesound.org/data/previews/387/387234_4280995-lq.mp3');
        this.initUI();
        this.setupSocketListeners();
    }

    initUI() {
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('instructions-modal').style.display = 'flex';
        });

        document.getElementById('instructions-ok').addEventListener('click', () => {
            document.getElementById('instructions-modal').style.display = 'none';
        });

        document.getElementById('join-btn').addEventListener('click', () => this.handleJoin());
        document.getElementById('bet-btn').addEventListener('click', () => this.handleBet());
        document.getElementById('roll-btn').addEventListener('click', () => this.handleRoll());
        document.getElementById('rematch-btn').addEventListener('click', () => this.handleRematch());
        document.getElementById('leave-btn').addEventListener('click', () => this.handleLeave());
        document.getElementById('modal-ok').addEventListener('click', () => this.hideWinnerModal());
        document.getElementById('send-chat').addEventListener('click', () => this.handleChat());
        document.getElementById('game-mode').addEventListener('change', () => this.handleGameMode());
    }

    handleJoin() {
        const roomCode = document.getElementById('room-code').value.trim();
        const username = document.getElementById('username').value.trim();
        if (!roomCode || !username) {
            alert('Please enter both an alias and a room code!');
            return;
        }
        this.roomCode = roomCode;
        document.getElementById('loading').style.display = 'block';
        document.getElementById('join-btn').disabled = true;
        this.socket.emit('joinRoom', { roomCode, username });
    }

    handleBet() {
        if (!this.canPlay) {
            this.updateResult('Wait for another player to join!');
            return;
        }
        const bet = parseInt(document.getElementById('bet-amount').value);
        if (isNaN(bet) || bet < 1) {
            this.updateResult('Bet must be at least 1 coin!');
        } else if (bet > this.myPlayer.coins) {
            this.updateResult('Not enough coins!');
        } else {
            this.socket.emit('placeBet', { roomCode: this.roomCode, bet });
            document.getElementById('bet-btn').disabled = true;
        }
    }

    handleRoll() {
        if (!this.canPlay) {
            this.updateResult('Wait for another player to join!');
            return;
        }
        const diceElements = ['die1', 'die2', 'die3'].map(id => document.getElementById(id));
        diceElements.forEach(die => {
            die.textContent = '?';
            die.classList.add('spinning');
        });
        this.rollSound.play();
        this.socket.emit('rollDice', this.roomCode);
    }

    handleRematch() {
        this.socket.emit('voteRematch', this.roomCode);
        document.getElementById('rematch-btn').disabled = true;
        this.updateResult(`${this.myPlayer.name} voted for a rematch...`);
    }

    handleLeave() {
        this.socket.close();
        this.resetGameState();
        this.socket = io(window.location.origin);
        this.setupSocketListeners();
    }

    handleChat() {
        const message = document.getElementById('chat-input').value.trim();
        if (message && this.roomCode) {
            this.socket.emit('chatMessage', { roomCode: this.roomCode, message: `${this.myPlayer.name}: ${message}` });
            document.getElementById('chat-input').value = '';
        }
    }

    handleGameMode() {
        const bestOf = document.getElementById('game-mode').value;
        this.socket.emit('setGameMode', { roomCode: this.roomCode, bestOf });
    }

    setupSocketListeners() {
        this.socket.on('joined', ({ roomCode, player }) => {
            this.roomCode = roomCode;
            this.myPlayer = player;
            document.getElementById('room-setup').style.display = 'none';
            document.getElementById('loading').style.display = 'none';
            document.getElementById('game').style.display = 'block';
            document.getElementById('player-name').textContent = player.name;
            document.getElementById('coins').textContent = player.coins;
            document.getElementById('join-btn').disabled = false;
            this.socket.emit('requestPlayersUpdate', this.roomCode);
        });

        this.socket.on('joinError', (msg) => {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('join-btn').disabled = false;
            alert(msg);
        });

        this.socket.on('updatePlayers', (players) => {
            this.updatePlayersList(players);
        });

        this.socket.on('roomStatus', ({ canPlay }) => {
            this.canPlay = canPlay;
            this.updateGameControls();
        });

        this.socket.on('diceRolled', ({ player, dice, result }) => {
            const diceElements = ['die1', 'die2', 'die3'].map(id => document.getElementById(id));
            setTimeout(() => {
                diceElements.forEach((die, i) => {
                    die.classList.remove('spinning');
                    die.textContent = dice[i];
                });
                this.updateResult(`${player}: ${result}`);
                if (result.includes("Rerolling")) {
                    setTimeout(() => {
                        diceElements.forEach(die => {
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
            this.startTimer(timeLeft);
            this.socket.emit('requestPlayersUpdate', this.roomCode);
        });

        this.socket.on('message', (msg) => {
            const messages = document.getElementById('messages');
            messages.innerHTML += `<p>${msg}</p>`;
            messages.scrollTop = messages.scrollHeight;
        });

        this.socket.on('gameOver', ({ message, winnerName, amount, roundCount, maxRounds, wins }) => {
            this.updateResult(`${message} (Round ${roundCount}/${maxRounds})`);
            document.getElementById('turn').textContent = '';
            this.stopTimer();
            document.getElementById('roll-btn').disabled = true;
            if (winnerName) {
                setTimeout(() => {
                    document.getElementById('winner-text').textContent = `${winnerName} won ${amount} coins! Wins: ${Object.entries(wins).map(([id, w]) => `${this.getPlayerName(id, wins)}: ${w}`).join(', ')}`;
                    document.getElementById('winner-modal').style.display = 'flex';
                    document.getElementById('winner-modal').classList.add('win-flash');
                    this.winSound.play();
                    this.startRematchTimer();
                }, 3000);
            }
        });

        this.socket.on('matchOver', ({ message, winnerName }) => {
            this.updateResult(message);
            setTimeout(() => {
                document.getElementById('winner-text').textContent = `${winnerName} wins the match!`;
                document.getElementById('winner-modal').style.display = 'flex';
                this.winSound.play();
            }, 3000);
        });

        this.socket.on('roundReset', () => {
            this.resetRoundUI();
        });

        this.socket.on('matchReset', () => {
            this.resetRoundUI();
            this.updateResult('Match reset. Place your bets!');
        });
    }

    updatePlayersList(players) {
        const playersDiv = document.getElementById('players');
        const turnPlayer = document.getElementById('turn').textContent.split(': ')[1] || '';
        playersDiv.innerHTML = players.map(p => `<p class="${p.name === turnPlayer ? 'active' : ''}">${p.name} - ${p.coins} coins${p.roundsWon ? ` (${p.roundsWon} wins)` : ''}</p>`).join('');
        if (this.myPlayer) {
            const me = players.find(p => p.id === this.myPlayer.id);
            if (me) {
                this.myPlayer.coins = me.coins;
                document.getElementById('coins').textContent = me.coins;
            }
        }
    }

    updateGameControls() {
        document.getElementById('bet-btn').disabled = !this.canPlay;
        document.getElementById('roll-btn').disabled = !this.canPlay || (document.getElementById('turn').textContent && document.getElementById('turn').textContent.split(': ')[1] !== this.myPlayer.name);
        this.updateResult(this.canPlay ? 'Place your bets!' : 'Waiting for another player to join...');
    }

    updateResult(message) {
        document.getElementById('result').textContent = message;
    }

    startTimer(timeLeft) {
        this.stopTimer();
        let time = timeLeft;
        document.getElementById('timer').textContent = `Time Left: ${time}s`;
        this.timerInterval = setInterval(() => {
            time--;
            document.getElementById('timer').textContent = `Time Left: ${time}s`;
            if (time <= 0) this.stopTimer();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            document.getElementById('timer').textContent = 'Time Left: --';
        }
    }

    startRematchTimer() {
        let time = 10;
        this.updateResult(`Rematch in ${time}s unless all vote...`);
        const rematchInterval = setInterval(() => {
            time--;
            this.updateResult(`Rematch in ${time}s unless all vote...`);
            if (time <= 0) {
                clearInterval(rematchInterval);
                this.socket.emit('voteRematch', this.roomCode);
            }
        }, 1000);
        document.getElementById('rematch-btn').addEventListener('click', () => clearInterval(rematchInterval), { once: true });
    }

    resetRoundUI() {
        document.getElementById('bet-amount').value = '';
        document.getElementById('bet-btn').disabled = !this.canPlay;
        document.getElementById('roll-btn').disabled = true;
        document.getElementById('rematch-btn').style.display = 'none';
        document.getElementById('rematch-btn').disabled = false;
        ['die1', 'die2', 'die3'].forEach(id => {
            const die = document.getElementById(id);
            die.classList.remove('spinning');
            die.textContent = '-';
        });
        this.updateResult(this.canPlay ? 'Place your bets for the next round!' : 'Waiting for another player to join...');
        this.stopTimer();
    }

    resetGameState() {
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
        document.getElementById('rematch-btn').style.display = 'none';
        document.getElementById('rematch-btn').disabled = false;
        ['die1', 'die2', 'die3'].forEach(id => {
            const die = document.getElementById(id);
            die.classList.remove('spinning');
            die.textContent = '-';
        });
        this.updateResult('');
        document.getElementById('turn').textContent = '';
        this.stopTimer();
        document.getElementById('messages').innerHTML = '';
        this.roomCode = null;
        this.myPlayer = null;
        this.canPlay = false;
    }

    hideWinnerModal() {
        document.getElementById('winner-modal').style.display = 'none';
        document.getElementById('rematch-btn').style.display = 'inline-block';
    }

    getPlayerName(id, wins) {
        return this.myPlayer && this.myPlayer.id === id ? this.myPlayer.name : Object.keys(wins).indexOf(id) + 1;
    }
}

const game = new CeeloGame();
