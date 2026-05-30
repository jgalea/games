// Reactions — one shared on-screen controller, any number of players.
// States: setup -> lobby -> cooldown -> flash -> reveal -> matchover
// Each player has their own physical pad; first to press the lit button wins
// the round. After every round the screen shows the winner + reaction time,
// then returns to the controller for the next round.

var Game = (function () {

  var BUTTONS = [
    { id: 'cross',    index: 0  },
    { id: 'circle',   index: 1  },
    { id: 'square',   index: 2  },
    { id: 'triangle', index: 3  },
    { id: 'up',       index: 12 },
    { id: 'down',     index: 13 },
    { id: 'left',     index: 14 },
    { id: 'right',    index: 15 }
  ];

  var PALETTE = ['#5b8def', '#ef5b6b', '#4fc4a8', '#ffd23f', '#c479d4', '#f0883e', '#54d1f0', '#9ae65b'];
  var MAX_PLAYERS = 8;

  var state = 'setup';
  var targetScore = 5;
  var players = [];          // { name, color, score, pad }

  var current = null;
  var flashTime = 0;
  var flashTimer = null;
  var revealTimer = null;
  var outThisRound = null;   // Set of player indices locked out of the current round
  var canAdvanceAt = 0;

  var el = {};
  var ctrlEl = null;

  // ---- audio ----
  var Audio2 = (function () {
    var ctx = null;
    function ac() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; }
    function tone(freq, dur, type, delay, vol) {
      var c = ac(); var t = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      ctx: ac,
      flash: function () { tone(880, 0.18, 'square', 0, 0.35); },
      win:   function () { tone(660, 0.1, 'triangle', 0, 0.3); tone(990, 0.2, 'triangle', 0.1, 0.3); },
      foul:  function () { tone(150, 0.3, 'sawtooth', 0, 0.3); },
      count: function () { tone(440, 0.14, 'square', 0, 0.3); },
      go:    function () { tone(880, 0.25, 'square', 0, 0.35); },
      join:  function () { tone(523, 0.12, 'square', 0, 0.3); tone(784, 0.14, 'square', 0.07, 0.3); }
    };
  })();

  // ---- background 8-bit music (~16s loop) ----
  var Music = (function () {
    var F = {
      'C3':130.81,'D3':146.83,'E3':164.81,'F3':174.61,'G3':196.00,'A3':220.00,'B3':246.94,
      'C4':261.63,'D4':293.66,'E4':329.63,'F4':349.23,'G4':392.00,'A4':440.00,'B4':493.88,
      'C5':523.25,'D5':587.33,'E5':659.25
    };
    var MELODY = [
      'E4','.','G4','.','C5','.','G4','.', 'D4','.','G4','.','B4','.','D5','.',
      'C4','.','E4','.','A4','.','E4','.', 'C4','.','F4','.','A4','.','G4','.',
      'E5','.','D5','.','C5','.','G4','.', 'D5','.','B4','.','G4','.','D4','.',
      'A4','.','C5','.','F4','.','A4','.', 'G4','.','B4','.','D5','.','.','.'
    ];
    var BASS = ['C3','G3','A3','F3','C3','G3','F3','G3'];
    var STEP_MS = 250;
    var timer = null, step = 0, on = true, started = false;
    function blip(freq, dur, type, vol, attack) {
      var c = Audio2.ctx(), t = c.currentTime;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + (attack || 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function tick() {
      if (on) {
        var n = MELODY[step];
        if (n !== '.') blip(F[n], 0.34, 'triangle', 0.045, 0.03);
        var bar = Math.floor(step / 8) % BASS.length;
        if (step % 8 === 0) blip(F[BASS[bar]], 0.85, 'sine', 0.06, 0.02);
        if (step % 8 === 4) blip(F[BASS[bar]] * 1.5, 0.4, 'sine', 0.03, 0.02);
      }
      step = (step + 1) % MELODY.length;
    }
    return {
      start: function () { if (started) return; started = true; var c = Audio2.ctx(); if (c.resume) c.resume(); timer = setInterval(tick, STEP_MS); },
      toggle: function () { on = !on; var c = Audio2.ctx(); if (on && c.resume) c.resume(); return on; }
    };
  })();

  // ---- helpers ----
  function setScreen(name) { state = name; el.app.setAttribute('data-screen', name); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function playerByPad(pad) {
    for (var i = 0; i < players.length; i++) if (players[i].pad === pad) return i;
    return -1;
  }

  // ---- lobby ----
  function enterLobby() {
    var t = parseInt(el.target.value, 10);
    targetScore = Math.max(1, Math.min(20, isNaN(t) ? 5 : t));
    el.target.value = targetScore;
    players = [];
    Music.start();
    renderLobby();
    setScreen('lobby');
  }

  function syncNamesFromInputs() {
    var inputs = el.lobbyList.querySelectorAll('input[data-pi]');
    for (var i = 0; i < inputs.length; i++) {
      var pi = parseInt(inputs[i].getAttribute('data-pi'), 10);
      var v = inputs[i].value.trim();
      if (players[pi]) players[pi].name = v || ('Player ' + (pi + 1));
    }
  }

  function addPlayer(pad) {
    if (playerByPad(pad) !== -1 || players.length >= MAX_PLAYERS) return;
    syncNamesFromInputs();
    players.push({ name: 'Player ' + (players.length + 1), color: PALETTE[players.length % PALETTE.length], score: 0, pad: pad });
    Audio2.join();
    renderLobby();
  }

  function renderLobby() {
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      html += '<div class="lobby-row">'
        + '<span class="pdot" style="background:' + p.color + '"></span>'
        + '<input data-pi="' + i + '" maxlength="12" value="' + p.name.replace(/"/g, '&quot;') + '">'
        + '<span class="pctrl">Controller ' + (i + 1) + '</span>'
        + '</div>';
    }
    el.lobbyList.innerHTML = html;
    el.lobbyEmpty.style.display = players.length ? 'none' : 'block';
    el.startGame.disabled = players.length < 2;
  }

  function startFromLobby() {
    syncNamesFromInputs();
    if (players.length < 2) return;
    startMatch();
  }

  // ---- match / rounds ----
  function startMatch() {
    for (var i = 0; i < players.length; i++) players[i].score = 0;
    setScreen('game');
    showPlay();
    renderScoreboard(-1);
    countdown(3);
  }

  function showPlay() {
    el.revealView.hidden = true;
    el.playView.hidden = false;
  }

  function countdown(n) {
    state = 'cooldown';
    clearTimeout(flashTimer);
    Controller.clear(ctrlEl);
    showPlay();
    if (n > 0) {
      el.status.className = 'status'; void el.status.offsetWidth;
      el.status.className = 'status count';
      el.status.textContent = n;
      Audio2.count();
      flashTimer = setTimeout(function () { countdown(n - 1); }, 700);
    } else {
      el.status.className = 'status go';
      el.status.textContent = 'Go!';
      Audio2.go();
      scheduleFlash(700, 1400);
    }
  }

  function scheduleFlash(minMs, maxMs) {
    state = 'cooldown';
    outThisRound = {};
    clearTimeout(flashTimer);
    Controller.clear(ctrlEl);
    showPlay();
    el.status.className = 'status';
    el.status.textContent = 'Get ready…';
    flashTimer = setTimeout(doFlash, rand(minMs, maxMs));
  }

  function doFlash() {
    current = BUTTONS[Math.floor(Math.random() * BUTTONS.length)];
    flashTime = performance.now();
    state = 'flash';
    Controller.highlight(ctrlEl, current.id);
    el.status.className = 'status go';
    el.status.textContent = 'PRESS!';
    Audio2.flash();
  }

  function winRound(playerIdx, reactionMs) {
    clearTimeout(flashTimer);
    Controller.clear(ctrlEl);
    players[playerIdx].score++;
    renderScoreboard(playerIdx);
    reveal(players[playerIdx].name, players[playerIdx].color, Math.round(reactionMs) + ' ms');
    Audio2.win();
    if (players[playerIdx].score >= targetScore) {
      canAdvanceAt = performance.now() + 1600;
      clearTimeout(revealTimer);
      revealTimer = setTimeout(function () { showMatchOver(playerIdx); }, 1700);
    } else {
      clearTimeout(revealTimer);
      revealTimer = setTimeout(function () { scheduleFlash(500, 1500); }, 1700);
    }
  }

  function voidRound() {
    clearTimeout(flashTimer);
    Controller.clear(ctrlEl);
    reveal('Nobody got it!', '#8b8fa3', '');
    clearTimeout(revealTimer);
    revealTimer = setTimeout(function () { scheduleFlash(500, 1500); }, 1400);
  }

  function reveal(name, color, ms) {
    state = 'reveal';
    el.playView.hidden = true;
    el.revealView.hidden = false;
    el.revealName.textContent = name;
    el.revealName.style.color = color;
    el.revealMs.textContent = ms;
  }

  function showMatchOver(winnerIdx) {
    el.winnerName.textContent = players[winnerIdx].name + ' wins!';
    el.winnerName.style.color = players[winnerIdx].color;
    var rows = players.slice().sort(function (a, b) { return b.score - a.score; });
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="fs-row"><span class="pdot" style="background:' + rows[i].color + '"></span>'
        + '<span class="fs-name">' + escapeHtml(rows[i].name) + '</span>'
        + '<span class="fs-score">' + rows[i].score + '</span></div>';
    }
    el.finalScores.innerHTML = html;
    setScreen('matchover');
    state = 'matchover';
  }

  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderScoreboard(winnerIdx) {
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      html += '<div class="chip' + (i === winnerIdx ? ' win' : '') + '" style="--pc:' + p.color + '">'
        + '<span class="pdot" style="background:' + p.color + '"></span>'
        + '<span class="cname">' + escapeHtml(p.name) + '</span>'
        + '<span class="cscore">' + p.score + '</span>'
        + '</div>';
    }
    el.scoreboard.innerHTML = html;
  }

  // ---- input router ----
  function handlePress(evt) {
    if (state === 'lobby') {
      var pi = playerByPad(evt.gamepadIndex);
      if (pi === -1) { addPlayer(evt.gamepadIndex); return; }
      if (evt.buttonIndex === 9 && players.length >= 2) startFromLobby(); // Options = start
      return;
    }

    if (state === 'cooldown') {
      var pc = playerByPad(evt.gamepadIndex);
      if (pc >= 0 && outThisRound && !outThisRound[pc]) outThisRound[pc] = true; // jumped early
      return;
    }

    if (state === 'flash') {
      var p = playerByPad(evt.gamepadIndex);
      if (p < 0 || outThisRound[p]) return;
      if (evt.buttonIndex === current.index) {
        winRound(p, evt.time - flashTime);
      } else {
        outThisRound[p] = true;
        Audio2.foul();
        var n = 0; for (var k in outThisRound) if (outThisRound[k]) n++;
        if (n >= players.length) voidRound();
      }
      return;
    }

    if (state === 'matchover') {
      if (evt.time >= canAdvanceAt) startMatch();
      return;
    }
  }

  // ---- wiring ----
  function init() {
    el.app = document.getElementById('app');
    el.target = document.getElementById('target');
    el.lobbyList = document.getElementById('lobbyList');
    el.lobbyEmpty = document.getElementById('lobbyEmpty');
    el.startGame = document.getElementById('startGame');
    el.scoreboard = document.getElementById('scoreboard');
    el.playView = document.getElementById('playView');
    el.revealView = document.getElementById('revealView');
    el.status = document.getElementById('status');
    el.revealName = document.getElementById('revealName');
    el.revealMs = document.getElementById('revealMs');
    el.winnerName = document.getElementById('winnerName');
    el.finalScores = document.getElementById('finalScores');

    ctrlEl = document.getElementById('ctrl');
    Controller.build(ctrlEl);

    document.getElementById('toLobby').addEventListener('click', enterLobby);
    document.getElementById('lobbyBack').addEventListener('click', function () { setScreen('setup'); });
    document.getElementById('startGame').addEventListener('click', startFromLobby);
    document.getElementById('newPlayers').addEventListener('click', function () { setScreen('lobby'); renderLobby(); });

    var muteBtn = document.getElementById('muteBtn');
    muteBtn.addEventListener('click', function () { muteBtn.textContent = Music.toggle() ? '🔊' : '🔇'; });

    Gamepads.onButtonDown(handlePress);
    Gamepads.start();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { _press: function (e) { handlePress(e); }, _state: function () { return state; } };
})();
