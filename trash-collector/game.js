// Trash Collector — two-player split-screen 8-bit racer.
// Top-down view. Each player drives a garbage truck left-to-right along its own
// road, parking in marked bays to load 5 dumpsters, dodging groundhogs and
// puddles, grabbing trash bags for ammo, and lobbing hazards into the rival's
// lane. Fill all 5 to unlock the finish gate. Best of three wins the match.

(function () {
  'use strict';

  // ---- Fixed internal resolution (scaled up, pixelated, by fitCanvas) --------
  var CANVAS_W = 640, CANVAS_H = 360;
  var PANEL_H = 180;                    // each player's panel height
  var HUD_H = 22;                       // HUD strip at top of each panel
  var PROG_H = 8;                       // progress strip at bottom of each panel
  var ROAD_TOP = HUD_H + 6;             // road band, panel-local y
  var ROAD_BOT = PANEL_H - 6 - PROG_H;
  var WORLD_W = CANVAS_W * 4;           // track length
  var MARGIN = 40;
  var FINISH_X = WORLD_W - 90;
  var ROAD_H = ROAD_BOT - ROAD_TOP;

  var TRUCK_HALF_W = 22, TRUCK_HALF_H = 12;
  var MAX_SPEED = 175;                  // px/s top speed
  var ACCEL = 520;                      // px/s^2 ramp up
  var BRAKE = 900;                      // px/s^2 slow down when no input
  var STOP_EPS = 16;                    // |velocity| below this counts as parked
  var LOAD_TIME = 1.2;                  // seconds to fill one dumpster
  var PARK_TOL_X = 26, PARK_TOL_Y = 15; // anywhere inside the bay counts as parked
  var BAY_W = 54, BAY_H = 30;           // dashed parking bay size
  var DUMPSTER_COUNT = 5;

  var STUN_TIME = 1.0;                  // spin-out after hitting a hazard
  var HOG_SPEED = 58;                   // px/s crossing speed
  var HOG_MAX = 3;                      // concurrent groundhogs per lane
  var HOG_MIN_GAP = 1.6, HOG_MAX_GAP = 3.6;
  var LEADER_HOG_SCALE = 0.62;          // leader's lane gets hogs more often
  var TRAIL_BOOST = 1.10;               // trailing player's speed/accel multiplier

  var AMMO_MAX = 3;
  var HAZARD_LIFE = 6.0;                // seconds a thrown hazard sits in the lane
  var WIN_TARGET = 2;                   // best of three

  // ---- Palette ---------------------------------------------------------------
  var COL = {
    grass: '#2d5a3d',
    road: '#3a3d46', roadEdge: '#23252b',
    lane: '#e8c23a',
    p1: '#4fc4a8', p2: '#ef8b3f',
    cab: '#dfe6f2', cabDark: '#aab4c8',
    dumpster: '#3f8f4f', dumpsterLid: '#2c6b39', dumpsterEmpty: '#6b7280',
    finishA: '#f2f2f2', finishB: '#16181d',
    lock: '#e0444f', open: '#5fd06a',
    hud: '#0c0e16', hudText: '#f4f6ff',
    puddle: '#3b6f9c', bag: '#9aa0aa', hazard: '#f2d23a'
  };

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---- Audio (tiny WebAudio chiptune + engine drone) ------------------------
  var Audio2 = (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctxA = AC ? new AC() : null;
    var engines = [];

    function resume() { if (ctxA && ctxA.state === 'suspended') ctxA.resume(); }

    function blip(freq, dur, type, vol) {
      if (!ctxA) return;
      var o = ctxA.createOscillator(), g = ctxA.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.value = vol == null ? 0.06 : vol;
      o.connect(g); g.connect(ctxA.destination);
      var t = ctxA.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    }

    function noise(dur, vol, hp) {
      if (!ctxA) return;
      var n = Math.floor(ctxA.sampleRate * dur);
      var buf = ctxA.createBuffer(1, n, ctxA.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var src = ctxA.createBufferSource(); src.buffer = buf;
      var f = ctxA.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 1400;
      var g = ctxA.createGain(); g.gain.value = vol || 0.05;
      src.connect(f); f.connect(g); g.connect(ctxA.destination);
      var t = ctxA.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.start(t); src.stop(t + dur);
    }

    function ensureEngines() {
      if (!ctxA || engines.length) return;
      for (var i = 0; i < 2; i++) {
        var o = ctxA.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 70;
        var f = ctxA.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        var g = ctxA.createGain(); g.gain.value = 0;
        o.connect(f); f.connect(g); g.connect(ctxA.destination); o.start();
        engines.push({ o: o, g: g });
      }
    }
    function setEngine(i, frac) {
      ensureEngines();
      if (!engines[i]) return;
      engines[i].o.frequency.value = 60 + frac * 150;
      engines[i].g.gain.value = 0.016 + frac * 0.03;
    }
    function enginesOff() { for (var i = 0; i < engines.length; i++) engines[i].g.gain.value = 0; }

    function tick() { blip(220, 0.05, 'square', 0.04); }
    function banked() {
      blip(160, 0.09, 'square', 0.07);                                  // clunk
      setTimeout(function () { blip(523, 0.08, 'square'); }, 70);
      setTimeout(function () { blip(784, 0.13, 'square'); }, 150);      // whirr up
    }
    function screech() { noise(0.16, 0.05, 1800); }
    function thud() { blip(110, 0.16, 'sawtooth', 0.09); noise(0.12, 0.04, 700); }
    function pickup() { blip(660, 0.06, 'square', 0.06); setTimeout(function () { blip(990, 0.07, 'square', 0.06); }, 55); }
    function whoosh() { noise(0.22, 0.05, 500); }
    function countdown(n) { blip(n > 0 ? 440 : 880, 0.12, n > 0 ? 'square' : 'sawtooth'); }
    function win() {
      [523, 659, 784, 1046].forEach(function (f, i) {
        setTimeout(function () { blip(f, 0.15, 'square'); }, i * 110);
      });
    }

    return {
      resume: resume, tick: tick, banked: banked, screech: screech, thud: thud,
      pickup: pickup, whoosh: whoosh, countdown: countdown, win: win,
      setEngine: setEngine, enginesOff: enginesOff
    };
  })();

  // ---- Per-round world (positions shared by both lanes for fairness) --------
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function makeWorld() {
    var segs = [[0.10, 0.20], [0.27, 0.37], [0.45, 0.55], [0.63, 0.73], [0.80, 0.90]];
    var toX = function (fx) { return MARGIN + fx * (FINISH_X - MARGIN * 2); };
    var toY = function (fy) { return ROAD_TOP + fy * ROAD_H; };

    var dumpsters = segs.map(function (s) {
      return { x: toX(rnd(s[0], s[1])), y: toY(rnd(0.22, 0.78)) };
    });
    var puddles = [];
    for (var i = 0; i < 4; i++) {
      puddles.push({ x: toX(rnd(0.14, 0.92)), y: toY(rnd(0.2, 0.8)), r: rnd(15, 26) });
    }
    var bags = [];
    for (var j = 0; j < 3; j++) {
      bags.push({ x: toX(rnd(0.2, 0.88)), y: toY(rnd(0.2, 0.8)) });
    }
    return { dumpsters: dumpsters, puddles: puddles, bags: bags };
  }

  // ---- Player / lane state ---------------------------------------------------
  function makePlayer(index, world) {
    var center = (ROAD_TOP + ROAD_BOT) / 2;
    var dumpsters = world.dumpsters.map(function (d) {
      var bayY = clamp(d.y + (d.y < center ? 30 : -30),
                       ROAD_TOP + TRUCK_HALF_H, ROAD_BOT - TRUCK_HALF_H);
      return { x: d.x, y: d.y, bayX: d.x, bayY: bayY, fill: 0, banked: false };
    });
    var bags = world.bags.map(function (b) { return { x: b.x, y: b.y, picked: false }; });
    return {
      index: index,
      color: index === 0 ? COL.p1 : COL.p2,
      panelTop: index === 0 ? 0 : PANEL_H,
      x: MARGIN,
      y: ROAD_TOP + ROAD_H / 2,
      vx: 0, vy: 0,
      facing: 0,
      stun: 0, spin: 0,
      shake: 0,
      loading: false,
      loadTickAt: 0,
      lastSkidAt: 0,
      collected: 0,
      ammo: 0,
      dumpsters: dumpsters,
      bags: bags,
      puddles: world.puddles,   // static, read-only
      hogs: [],
      hazards: [],               // hazards thrown into THIS lane by the rival
      particles: [],
      skids: [],
      nextHogAt: rnd(1.4, 3.0),
      ready: false,
      finished: false
    };
  }

  var roundWorld = makeWorld();
  var players = [makePlayer(0, roundWorld), makePlayer(1, roundWorld)];

  // ---- Game state ------------------------------------------------------------
  var STATE = { MENU: 'menu', TITLE: 'title', COUNTDOWN: 'countdown', RACE: 'race', PAUSE: 'pause', WIN: 'win' };
  var state = STATE.MENU;
  var stateTime = 0;
  var countdownLeft = 0;
  var lastCountdownShown = -1;
  var winner = -1;
  var wins = [0, 0];
  var matchOver = false;
  var scheme = 'gamepad';     // chosen control scheme: 'keyboard' | 'gamepad'
  var menuSel = 1;            // 0 = keyboard, 1 = gamepad
  var menuAxisPrev = 0;
  var PAUSE_OPTS = ['RESUME', 'RESTART ROUND', 'MAIN MENU'];
  var pauseSel = 0, pauseAxisPrev = 0;

  function startRound(keepReady) {
    roundWorld = makeWorld();
    players = [makePlayer(0, roundWorld), makePlayer(1, roundWorld)];
    if (keepReady) { players[0].ready = true; players[1].ready = true; }
    winner = -1;
  }

  function setState(s) {
    state = s;
    stateTime = 0;
    Input.syncEdges();
    if (s !== STATE.RACE) Audio2.enginesOff();
    if (s === STATE.COUNTDOWN) { countdownLeft = 3.999; lastCountdownShown = -1; }
  }

  // ---- Update ----------------------------------------------------------------
  function update(dt) {
    stateTime += dt;
    if (state === STATE.MENU) updateMenu();
    else if (state === STATE.TITLE) updateTitle();
    else if (state === STATE.COUNTDOWN) updateCountdown(dt);
    else if (state === STATE.RACE) updateRace(dt);
    else if (state === STATE.PAUSE) updatePause();
    else if (state === STATE.WIN) updateWin();
    else Input.syncEdges();
  }

  // Vertical menu navigation for the pause menu: returns -1, 0, or 1.
  function menuVertical() {
    var m0 = Input.move(0), m1 = Input.move(1), ay = 0;
    if (Math.abs(m0.y) > 0.5) ay = m0.y > 0 ? 1 : -1;
    else if (Math.abs(m1.y) > 0.5) ay = m1.y > 0 ? 1 : -1;
    return ay;
  }

  function updatePause() {
    if (Input.backPressed()) { setState(STATE.RACE); return; }   // Esc / Circle resumes
    var ay = menuVertical();
    if (ay !== 0 && pauseAxisPrev === 0) {
      pauseSel = (pauseSel + ay + PAUSE_OPTS.length) % PAUSE_OPTS.length;
      Audio2.tick();
    }
    pauseAxisPrev = ay;

    if (Input.actionPressed(0) || Input.actionPressed(1)) {
      if (pauseSel === 0) { setState(STATE.RACE); }
      else if (pauseSel === 1) { startRound(true); setState(STATE.COUNTDOWN); }
      else { wins = [0, 0]; matchOver = false; startRound(false); setState(STATE.MENU); }
    }
  }

  function updateMenu() {
    // Highlight moves on a fresh left/right from either player or the keyboard.
    var m0 = Input.move(0), m1 = Input.move(1);
    var ax = 0;
    if (Math.abs(m0.x) > 0.5) ax = m0.x > 0 ? 1 : -1;
    else if (Math.abs(m1.x) > 0.5) ax = m1.x > 0 ? 1 : -1;
    if (ax !== 0 && menuAxisPrev === 0) { menuSel = ax > 0 ? 1 : 0; Audio2.resume(); Audio2.tick(); }
    menuAxisPrev = ax;

    if (Input.actionPressed(0) || Input.actionPressed(1)) {
      Audio2.resume();
      scheme = menuSel === 0 ? 'keyboard' : 'gamepad';
      Audio2.countdown(1);
      startRound(false);          // fresh, un-readied players for the new game
      setState(STATE.TITLE);
    }
  }

  function updateTitle() {
    if (Input.backPressed()) { setState(STATE.MENU); return; }
    for (var i = 0; i < 2; i++) {
      if (!players[i].ready && Input.actionPressed(i)) {
        Audio2.resume();
        players[i].ready = true;
        Audio2.countdown(1);
      }
    }
    if (players[0].ready && players[1].ready) setState(STATE.COUNTDOWN);
  }

  function updateCountdown(dt) {
    Input.syncEdges();
    countdownLeft -= dt;
    var shown = Math.ceil(countdownLeft - 1);
    if (shown !== lastCountdownShown && shown >= 0) {
      lastCountdownShown = shown;
      Audio2.countdown(shown);
    }
    if (countdownLeft <= 1) setState(STATE.RACE);
  }

  // Progress metric: collected dumpsters dominate, position breaks ties.
  function progressMetric(p) { return p.collected * WORLD_W + p.x; }

  function updateRace(dt) {
    // Note: do NOT call Input.syncEdges() here — it would clobber the throw
    // button's edge state before handleThrow reads it. setState() refreshes
    // edges on every state transition, which is all that's needed.

    // Esc / Circle opens the pause menu.
    if (Input.backPressed()) { pauseSel = 0; pauseAxisPrev = 0; setState(STATE.PAUSE); return; }

    // Determine who is leading for catch-up tuning.
    var leadIndex = progressMetric(players[0]) >= progressMetric(players[1]) ? 0 : 1;

    for (var i = 0; i < 2; i++) {
      var p = players[i];
      handleThrow(p, dt);
      updateHogs(p, dt, i === leadIndex);
      updateHazards(p, dt);
      updateTruck(p, dt, i !== leadIndex);
      updateParticles(p, dt);
      updateSkids(p, dt);
      Audio2.setEngine(i, p.finished ? 0 : Math.min(Math.hypot(p.vx, p.vy) / MAX_SPEED, 1));
    }
  }

  function inPuddle(p) {
    for (var i = 0; i < p.puddles.length; i++) {
      var pd = p.puddles[i];
      if (Math.abs(pd.x - p.x) < pd.r && Math.abs(pd.y - p.y) < pd.r * 0.7) return true;
    }
    return false;
  }

  function updateTruck(p, dt, trailing) {
    if (p.finished) return;

    if (p.stun > 0) {
      p.stun -= dt;
      p.spin += dt * 16;
      p.vx = 0; p.vy = 0;
      p.loading = false;
      return;
    }

    var mv = Input.move(p.index);
    var mag = Math.hypot(mv.x, mv.y);
    var boost = trailing ? TRAIL_BOOST : 1;
    var slippery = inPuddle(p);

    var tx = mv.x * MAX_SPEED * boost, ty = mv.y * MAX_SPEED * boost;
    var rate = (mag > 0.05 ? ACCEL * boost : BRAKE) * (slippery ? 0.35 : 1) * dt;

    var prevSpeed = Math.hypot(p.vx, p.vy);
    p.vx = approach(p.vx, tx, rate);
    p.vy = approach(p.vy, ty, rate);

    // On ice-like puddles, nudge a little sideways drift for the loss-of-grip feel.
    if (slippery && prevSpeed > 60) {
      p.vx += rnd(-12, 12); p.vy += rnd(-12, 12);
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    var speed = Math.hypot(p.vx, p.vy);
    if (speed > 8) p.facing = Math.atan2(p.vy, p.vx);

    // Hard braking: skid marks + screech + exhaust-free deceleration cue.
    var braking = mag < 0.05 || (mv.x * p.vx + mv.y * p.vy) < -10;
    if (braking && speed > 95 && performance.now() - p.lastSkidAt > 45) {
      p.lastSkidAt = performance.now();
      spawnSkid(p);
      if (Math.random() < 0.25) Audio2.screech();
    }
    // Exhaust puffs while accelerating.
    if (mag > 0.4 && speed > 30 && Math.random() < 0.4) spawnSmoke(p);

    // Clamp to road band and track; locked finish acts as a wall.
    var unlocked = p.collected >= DUMPSTER_COUNT;
    var maxX = unlocked ? WORLD_W - MARGIN : FINISH_X - TRUCK_HALF_W;
    var nx = clamp(p.x, MARGIN, maxX);
    var ny = clamp(p.y, ROAD_TOP + TRUCK_HALF_H, ROAD_BOT - TRUCK_HALF_H);
    if (nx !== p.x) p.vx = 0;
    if (ny !== p.y) p.vy = 0;
    p.x = nx; p.y = ny;

    // Dumpsters are solid: push the truck back out and you drive around them.
    blockByDumpsters(p);

    // Ammo pickups.
    for (var b = 0; b < p.bags.length; b++) {
      var bag = p.bags[b];
      if (!bag.picked && Math.abs(bag.x - p.x) < TRUCK_HALF_W && Math.abs(bag.y - p.y) < TRUCK_HALF_H + 4) {
        bag.picked = true;
        if (p.ammo < AMMO_MAX) p.ammo++;
        Audio2.pickup();
      }
    }

    // Loading: sit inside a dumpster bay, nearly stopped, holding action.
    var bay = parkedAt(p);
    p.loading = false;
    if (bay && speed < STOP_EPS && Input.action(p.index)) {
      p.loading = true;
      bay.fill += dt / LOAD_TIME;
      if (performance.now() - p.loadTickAt > 120) {
        Audio2.tick();
        spawnTrashFleck(p, bay);
        p.loadTickAt = performance.now();
      }
      if (bay.fill >= 1) {
        bay.fill = 1;
        bay.banked = true;
        p.collected++;
        p.loading = false;
        p.shake = 5;
        for (var s = 0; s < 8; s++) spawnTrashFleck(p, bay);
        Audio2.banked();
      }
    }

    if (unlocked && p.x + TRUCK_HALF_W >= FINISH_X) {
      p.finished = true;
      if (winner === -1) {
        winner = p.index;
        wins[winner]++;
        matchOver = wins[winner] >= WIN_TARGET;
        Audio2.win();
        setState(STATE.WIN);
      }
    }
  }

  // AABB push-out so the truck can't drive through a dumpster's body.
  function blockByDumpsters(p) {
    var thw = TRUCK_HALF_W - 3, thh = TRUCK_HALF_H - 1;
    var dhw = 15, dhh = 13;
    for (var i = 0; i < p.dumpsters.length; i++) {
      var d = p.dumpsters[i];
      var dx = p.x - d.x, dy = p.y - d.y;
      var ox = (thw + dhw) - Math.abs(dx);
      var oy = (thh + dhh) - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) { p.x = d.x + (dx < 0 ? -1 : 1) * (thw + dhw); p.vx = 0; }
        else { p.y = d.y + (dy < 0 ? -1 : 1) * (thh + dhh); p.vy = 0; }
      }
    }
  }

  function parkedAt(p) {
    for (var i = 0; i < p.dumpsters.length; i++) {
      var d = p.dumpsters[i];
      if (d.banked) continue;
      if (Math.abs(d.bayX - p.x) < PARK_TOL_X && Math.abs(d.bayY - p.y) < PARK_TOL_Y) return d;
    }
    return null;
  }

  function approach(v, target, step) {
    if (v < target) return Math.min(v + step, target);
    if (v > target) return Math.max(v - step, target);
    return v;
  }

  // ---- Groundhogs ------------------------------------------------------------
  function updateHogs(p, dt, isLeader) {
    p.nextHogAt -= dt;
    if (p.nextHogAt <= 0 && p.hogs.length < HOG_MAX) {
      spawnHog(p);
      var lo = HOG_MIN_GAP, hi = HOG_MAX_GAP;
      if (isLeader) { lo *= LEADER_HOG_SCALE; hi *= LEADER_HOG_SCALE; }
      p.nextHogAt = rnd(lo, hi);
    }
    for (var i = p.hogs.length - 1; i >= 0; i--) {
      var h = p.hogs[i];
      h.y += h.vy * dt;
      h.wob += dt * 12;
      hitCheck(p, h, function () { h.vy *= 1.8; });
      if (h.y < ROAD_TOP - 14 || h.y > ROAD_BOT + 14) p.hogs.splice(i, 1);
    }
  }

  function spawnHog(p) {
    var fromTop = Math.random() < 0.5;
    p.hogs.push({
      x: clamp(p.x + 110 + Math.random() * 220, MARGIN, FINISH_X - 20),
      y: fromTop ? ROAD_TOP - 10 : ROAD_BOT + 10,
      vy: (fromTop ? 1 : -1) * HOG_SPEED,
      wob: Math.random() * 6
    });
  }

  // ---- Thrown hazards --------------------------------------------------------
  function handleThrow(p, dt) {
    if (p.stun > 0 || p.finished) return;
    if (Input.tossPressed(p.index) && p.ammo > 0) {
      p.ammo--;
      Audio2.whoosh();
      var target = players[1 - p.index];
      var ahead = target.collected >= DUMPSTER_COUNT ? WORLD_W - MARGIN : FINISH_X;
      target.hazards.push({
        x: clamp(target.x + 150 + Math.random() * 110, MARGIN, ahead - 12),
        y: clamp(ROAD_TOP + rnd(0.2, 0.8) * ROAD_H, ROAD_TOP + 8, ROAD_BOT - 8),
        life: HAZARD_LIFE, t: 0
      });
    }
  }

  function updateHazards(p, dt) {
    for (var i = p.hazards.length - 1; i >= 0; i--) {
      var hz = p.hazards[i];
      hz.life -= dt; hz.t += dt;
      var hit = hitCheck(p, hz, function () {});
      if (hit || hz.life <= 0) p.hazards.splice(i, 1);
    }
  }

  // Shared collision: if truck overlaps obj and isn't already stunned, spin out.
  function hitCheck(p, obj, onHit) {
    if (p.stun > 0 || p.finished) return false;
    if (Math.abs(obj.x - p.x) < TRUCK_HALF_W - 2 && Math.abs(obj.y - p.y) < TRUCK_HALF_H + 2) {
      p.stun = STUN_TIME; p.spin = 0; p.shake = 7;
      Audio2.thud();
      onHit();
      return true;
    }
    return false;
  }

  // ---- Particles & skids -----------------------------------------------------
  function spawnSmoke(p) {
    var back = p.facing + Math.PI;
    p.particles.push({
      x: p.x + Math.cos(back) * TRUCK_HALF_W, y: p.y + Math.sin(back) * TRUCK_HALF_W,
      vx: Math.cos(back) * 12 + rnd(-6, 6), vy: Math.sin(back) * 12 + rnd(-10, -2),
      life: 0.5, max: 0.5, size: 3, kind: 'smoke'
    });
    capParticles(p);
  }
  function spawnTrashFleck(p, bay) {
    p.particles.push({
      x: bay.x + rnd(-6, 6), y: bay.y + rnd(-4, 4),
      vx: (p.x - bay.x) * rnd(1, 2.2), vy: (p.y - bay.y) * rnd(1, 2.2) + rnd(-20, 20),
      life: 0.4, max: 0.4, size: 2, kind: 'trash'
    });
    capParticles(p);
  }
  function capParticles(p) { if (p.particles.length > 60) p.particles.splice(0, p.particles.length - 60); }

  function updateParticles(p, dt) {
    if (p.shake > 0) p.shake = Math.max(0, p.shake - dt * 22);
    for (var i = p.particles.length - 1; i >= 0; i--) {
      var pa = p.particles[i];
      pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      if (pa.kind === 'smoke') { pa.vx *= 0.92; pa.vy *= 0.92; pa.size += dt * 6; }
      pa.life -= dt;
      if (pa.life <= 0) p.particles.splice(i, 1);
    }
  }

  function spawnSkid(p) {
    var perp = p.facing + Math.PI / 2;
    var off = TRUCK_HALF_H - 2;
    p.skids.push({ x: p.x + Math.cos(perp) * off, y: p.y + Math.sin(perp) * off, life: 3 });
    p.skids.push({ x: p.x - Math.cos(perp) * off, y: p.y - Math.sin(perp) * off, life: 3 });
    if (p.skids.length > 120) p.skids.splice(0, p.skids.length - 120);
  }
  function updateSkids(p, dt) {
    for (var i = p.skids.length - 1; i >= 0; i--) {
      p.skids[i].life -= dt;
      if (p.skids[i].life <= 0) p.skids.splice(i, 1);
    }
  }

  function updateWin() {
    Input.syncEdges();
    if (stateTime > 0.6 && (Input.actionPressed(0) || Input.actionPressed(1))) {
      if (matchOver) { wins = [0, 0]; matchOver = false; }
      startRound(true);
      setState(STATE.COUNTDOWN);
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- Render ----------------------------------------------------------------
  function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawPanel(players[0]);
    drawPanel(players[1]);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, PANEL_H - 1, CANVAS_W, 2);

    if (state === STATE.MENU) drawMenu();
    else if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.COUNTDOWN) drawCountdown();
    else if (state === STATE.PAUSE) drawPause();
    else if (state === STATE.WIN) drawWin();
  }

  function cameraX(p) { return clamp(p.x - CANVAS_W / 2, 0, WORLD_W - CANVAS_W); }

  function drawPanel(p) {
    var top = p.panelTop;
    var cam = cameraX(p);
    var shx = p.shake > 0 ? rnd(-p.shake, p.shake) : 0;
    var shy = p.shake > 0 ? rnd(-p.shake, p.shake) : 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, CANVAS_W, PANEL_H);
    ctx.clip();
    ctx.translate(-cam + shx, top + shy);

    // Grass.
    ctx.fillStyle = COL.grass;
    ctx.fillRect(cam, 0, CANVAS_W, PANEL_H);

    // Road band.
    ctx.fillStyle = COL.roadEdge;
    ctx.fillRect(cam, ROAD_TOP - 3, CANVAS_W, ROAD_H + 6);
    ctx.fillStyle = COL.road;
    ctx.fillRect(cam, ROAD_TOP, CANVAS_W, ROAD_H);

    // Dashed centre line.
    ctx.fillStyle = COL.lane;
    var midY = (ROAD_TOP + ROAD_BOT) / 2 - 2;
    var startDash = Math.floor(cam / 40) * 40;
    for (var dx = startDash; dx < cam + CANVAS_W + 40; dx += 40) ctx.fillRect(dx, midY, 22, 4);

    p.puddles.forEach(function (pd) { drawPuddle(pd, cam); });
    drawSkids(p);
    drawFinish(p);
    var bay = parkedAt(p);
    var parkedReady = bay && Math.hypot(p.vx, p.vy) < STOP_EPS;
    p.dumpsters.forEach(function (d) { drawBay(d, d === bay && parkedReady); });
    p.dumpsters.forEach(function (d) { drawDumpster(d, cam); });
    p.bags.forEach(function (b) { drawBag(b, cam); });
    p.hazards.forEach(drawHazard);
    drawParticles(p, 'smoke');
    drawTruck(p);
    drawParticles(p, 'trash');
    p.hogs.forEach(drawHog);

    ctx.restore();

    drawHud(p, top);
    drawProgress(p, top);
    if (p.loading) drawFillBar(p, cam, top, shx);
  }

  function drawPuddle(pd, cam) {
    if (pd.x < cam - 40 || pd.x > cam + CANVAS_W + 40) return;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = COL.puddle;
    ctx.beginPath();
    ctx.ellipse(pd.x, pd.y, pd.r, pd.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#8fc7ee';
    ctx.fillRect(pd.x - pd.r * 0.4, pd.y - pd.r * 0.25, pd.r * 0.5, 2);
    ctx.restore();
  }

  function drawSkids(p) {
    for (var i = 0; i < p.skids.length; i++) {
      var s = p.skids[i];
      ctx.fillStyle = 'rgba(10,10,12,' + (0.4 * (s.life / 3)) + ')';
      ctx.fillRect(s.x - 2, s.y - 1, 4, 3);
    }
  }

  function drawFinish(p) {
    var unlocked = p.collected >= DUMPSTER_COUNT;
    var sq = 8;
    for (var y = ROAD_TOP; y < ROAD_BOT; y += sq) {
      for (var k = 0; k < 2; k++) {
        var even = ((Math.floor(y / sq) + k) % 2) === 0;
        ctx.fillStyle = even ? COL.finishA : COL.finishB;
        ctx.fillRect(FINISH_X + k * sq, y, sq, sq);
      }
    }
    ctx.fillStyle = unlocked ? COL.open : COL.lock;
    ctx.globalAlpha = unlocked ? 0.35 : 0.55;
    ctx.fillRect(FINISH_X - 4, ROAD_TOP, 4, ROAD_H);
    ctx.globalAlpha = 1;
  }

  function drawDumpster(d, cam) {
    if (d.x < cam - 30 || d.x > cam + CANVAS_W + 30) return;
    var w = 26, h = 20;
    var x = d.x - w / 2, y = d.y - h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 2, y + h - 2, w, 4);
    ctx.fillStyle = d.banked ? COL.dumpsterEmpty : COL.dumpster;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = d.banked ? '#565d68' : COL.dumpsterLid;
    ctx.fillRect(x - 1, y - 4, w + 2, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawBay(d, active) {
    if (d.banked) return;
    var x = d.bayX - BAY_W / 2, y = d.bayY - BAY_H / 2;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? COL.open : 'rgba(240,240,240,0.55)';
    ctx.strokeRect(x, y, BAY_W, BAY_H);
    ctx.setLineDash([]);
    ctx.fillStyle = active ? COL.open : 'rgba(240,240,240,0.55)';
    ctx.fillRect(d.bayX - 1, y - 4, 2, 4);
    ctx.restore();
  }

  function drawBag(b, cam) {
    if (b.picked || b.x < cam - 20 || b.x > cam + CANVAS_W + 20) return;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x - 5, b.y + 4, 12, 3);
    ctx.fillStyle = COL.bag;
    ctx.fillRect(b.x - 6, b.y - 5, 12, 11);
    ctx.fillStyle = '#c4cad4';
    ctx.fillRect(b.x - 4, b.y - 4, 8, 4);
    ctx.fillStyle = '#6b7280';            // twist tie
    ctx.fillRect(b.x - 1, b.y - 8, 2, 3);
  }

  function drawHazard(hz) {
    var blink = hz.life < 1.5 && Math.floor(hz.t * 8) % 2 === 0;
    if (blink) return;
    // Banana peel: yellow Y of three arms.
    ctx.save();
    ctx.translate(hz.x, hz.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-7, 4, 14, 3);
    ctx.fillStyle = COL.hazard;
    ctx.fillRect(-1, -7, 3, 9);
    ctx.fillRect(-7, 1, 9, 3);
    ctx.fillRect(0, 1, 8, 3);
    ctx.fillStyle = '#b89a1e';
    ctx.fillRect(-1, -7, 3, 2);
    ctx.restore();
  }

  function drawHog(h) {
    var bw = 14, bh = 10;
    var bob = Math.sin(h.wob) * 1;
    var cy = h.y + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(h.x - bw / 2 + 1, h.y + bh / 2 - 1, bw, 3);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(h.x - bw / 2, cy - bh / 2, bw, bh);
    ctx.fillStyle = '#6f4622';
    ctx.fillRect(h.x - bw / 2, cy - bh / 2, bw, 3);
    ctx.fillStyle = '#b07c44';
    ctx.fillRect(h.x - bw / 2 + 2, cy + bh / 2 - 3, bw - 4, 3);
    var hy = h.vy > 0 ? cy + bh / 2 - 1 : cy - bh / 2 - 4;
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(h.x - 4, hy, 8, 5);
    ctx.fillStyle = '#6f4622';
    ctx.fillRect(h.x - 4, hy - 1, 2, 2);
    ctx.fillRect(h.x + 2, hy - 1, 2, 2);
    ctx.fillStyle = '#120c08';
    ctx.fillRect(h.x - 3, hy + 1, 1, 1);
    ctx.fillRect(h.x + 2, hy + 1, 1, 1);
  }

  function drawParticles(p, kind) {
    for (var i = 0; i < p.particles.length; i++) {
      var pa = p.particles[i];
      if (pa.kind !== kind) continue;
      var a = pa.life / pa.max;
      if (kind === 'smoke') ctx.fillStyle = 'rgba(150,150,160,' + (0.5 * a) + ')';
      else ctx.fillStyle = i % 2 ? '#6fae5a' : '#b08a4a';
      var s = Math.max(1, pa.size);
      ctx.fillRect(pa.x - s / 2, pa.y - s / 2, s, s);
    }
  }

  // Top-down truck pointing +x in local space, rotated to its facing.
  function drawTruck(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.facing + (p.stun > 0 ? p.spin : 0));

    var bw = TRUCK_HALF_W * 2, bh = TRUCK_HALF_H * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-TRUCK_HALF_W + 2, -TRUCK_HALF_H + 3, bw, bh);

    ctx.fillStyle = p.color;
    ctx.fillRect(-TRUCK_HALF_W, -TRUCK_HALF_H, bw * 0.62, bh);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-TRUCK_HALF_W + 0.5, -TRUCK_HALF_H + 0.5, bw * 0.62, bh - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-TRUCK_HALF_W + bw * 0.2, -TRUCK_HALF_H + 2, 2, bh - 4);
    ctx.fillRect(-TRUCK_HALF_W + bw * 0.4, -TRUCK_HALF_H + 2, 2, bh - 4);

    var cabX = -TRUCK_HALF_W + bw * 0.62;
    ctx.fillStyle = COL.cab;
    ctx.fillRect(cabX, -TRUCK_HALF_H + 1, bw * 0.34, bh - 2);
    ctx.fillStyle = COL.cabDark;
    ctx.fillRect(cabX + 1, -TRUCK_HALF_H + 2, bw * 0.18, bh - 4);
    ctx.fillStyle = '#fff4b0';
    ctx.fillRect(TRUCK_HALF_W - 2, -TRUCK_HALF_H + 1, 2, 3);
    ctx.fillRect(TRUCK_HALF_W - 2, TRUCK_HALF_H - 4, 2, 3);

    ctx.fillStyle = '#15171c';
    ctx.fillRect(-TRUCK_HALF_W + 4, -TRUCK_HALF_H - 2, 8, 3);
    ctx.fillRect(-TRUCK_HALF_W + 4, TRUCK_HALF_H - 1, 8, 3);
    ctx.fillRect(cabX, -TRUCK_HALF_H - 2, 7, 3);
    ctx.fillRect(cabX, TRUCK_HALF_H - 1, 7, 3);

    ctx.restore();

    // Dizzy stars while stunned.
    if (p.stun > 0) {
      for (var s = 0; s < 3; s++) {
        var a = p.spin + s * (Math.PI * 2 / 3);
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(p.x + Math.cos(a) * 14 - 1, p.y - TRUCK_HALF_H - 6 + Math.sin(a) * 3 - 1, 2, 2);
      }
    }
  }

  function rankLabel(p) {
    var me = progressMetric(p), other = progressMetric(players[1 - p.index]);
    if (me === other) return '';
    return me > other ? '1st' : '2nd';
  }

  function drawHud(p, top) {
    ctx.fillStyle = COL.hud;
    ctx.fillRect(0, top, CANVAS_W, HUD_H);
    ctx.fillStyle = p.color;
    ctx.fillRect(0, top, 4, HUD_H);

    var unlocked = p.collected >= DUMPSTER_COUNT;
    var midY = top + HUD_H / 2;
    setFont(8);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = p.color;
    ctx.fillText('P' + (p.index + 1), 10, midY);
    ctx.fillStyle = COL.hudText;
    ctx.fillText('TRASH ' + p.collected + '/' + DUMPSTER_COUNT, 40, midY);
    ctx.fillText('AMMO ' + p.ammo, 150, midY);

    // Series score + rank, centred.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8890a8';
    ctx.fillText(wins[0] + '-' + wins[1], CANVAS_W / 2 - 60, midY);
    var rk = rankLabel(p);
    if (rk) { ctx.fillStyle = rk === '1st' ? COL.open : '#8890a8'; ctx.fillText(rk, CANVAS_W / 2, midY); }

    ctx.textAlign = 'right';
    ctx.fillStyle = unlocked ? COL.open : COL.lock;
    ctx.fillText(unlocked ? 'FINISH OPEN' : 'FINISH LOCKED', CANVAS_W - 10, midY);
    ctx.textAlign = 'left';
  }

  // Bottom strip: both trucks' positions along the whole track + dumpster ticks.
  function drawProgress(p, top) {
    var y = top + PANEL_H - PROG_H;
    ctx.fillStyle = '#11131c';
    ctx.fillRect(0, y, CANVAS_W, PROG_H);
    var pad = 8, w = CANVAS_W - pad * 2;
    var toScreen = function (wx) { return pad + (wx / WORLD_W) * w; };

    // dumpster ticks
    for (var i = 0; i < p.dumpsters.length; i++) {
      var d = p.dumpsters[i];
      ctx.fillStyle = d.banked ? COL.open : '#555b6b';
      ctx.fillRect(toScreen(d.x) - 1, y + 2, 2, PROG_H - 4);
    }
    // finish
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(toScreen(FINISH_X) - 1, y + 1, 2, PROG_H - 2);

    // rival marker (hollow), then self marker (solid).
    var rival = players[1 - p.index];
    ctx.fillStyle = rival.color;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(toScreen(rival.x) - 2, y + 2, 4, PROG_H - 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.color;
    ctx.fillRect(toScreen(p.x) - 2, y + 1, 4, PROG_H - 2);
  }

  function drawFillBar(p, cam, top, shx) {
    var sx = p.x - cam + (shx || 0);
    var sy = top + p.y - TRUCK_HALF_H - 12;
    if (sy < top + HUD_H) sy = top + HUD_H + 2;
    var bay = parkedAt(p);
    var fill = bay ? Math.min(bay.fill, 1) : 0;
    var w = 40, h = 6, x = sx - w / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, sy - 1, w + 2, h + 2);
    ctx.fillStyle = '#222';
    ctx.fillRect(x, sy, w, h);
    ctx.fillStyle = COL.lane;
    ctx.fillRect(x, sy, w * fill, h);
  }

  // ---- Overlays --------------------------------------------------------------
  function setFont(px) { ctx.font = px + "px 'Press Start 2P', monospace"; }

  function centerText(txt, y, px, color) { textAt(txt, CANVAS_W / 2, y, px, color, 'center'); }

  function textAt(txt, x, y, px, color, align) {
    setFont(px);
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(txt, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
    ctx.textAlign = 'left';
  }

  function drawMenu() {
    ctx.fillStyle = '#0a0c14';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    centerText('TRASH', 46, 26, COL.p1);
    centerText('COLLECTOR', 80, 26, COL.p2);
    centerText('2-PLAYER   -   BEST OF 3', 108, 9, COL.hudText);

    centerText('Load all 5 bins to open your finish, then race to it', 140, 8, '#c7ccda');
    centerText('Dodge groundhogs and puddles - a hit spins you out', 156, 8, '#c7ccda');
    centerText('Grab bags for ammo, throw a peel to spin your rival', 172, 8, '#c7ccda');

    centerText('CHOOSE YOUR CONTROLS', 208, 9, COL.hudText);
    var kx = CANVAS_W / 2 - 86, gx = CANVAS_W / 2 + 86, oy = 236;
    textAt('KEYBOARD', kx, oy, 12, menuSel === 0 ? COL.open : '#5a6072');
    textAt('GAMEPAD', gx, oy, 12, menuSel === 1 ? COL.open : '#5a6072');
    var sx = menuSel === 0 ? kx : gx, sw = menuSel === 0 ? 80 : 70;
    ctx.fillStyle = COL.open;
    ctx.fillRect(sx - sw / 2, oy + 12, sw, 2);

    centerText('left / right to choose      SPACE / X to start', 278, 8, '#8890a8');
    centerText(Input.connectedCount() + ' gamepad(s) connected', 302, 8, '#8890a8');
  }

  function drawTitle() {
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    centerText('GET READY', 52, 20, COL.hudText);
    centerText((scheme === 'keyboard' ? 'KEYBOARD' : 'GAMEPAD') + ' CONTROLS', 78, 9, '#8890a8');

    if (scheme === 'keyboard') {
      centerText('P1   move W A S D     load SPACE     throw E', 108, 8, COL.p1);
      centerText('P2   move ARROWS      load ENTER     throw /', 126, 8, COL.p2);
    } else {
      centerText('one controller each  -  P1 = pad 1, P2 = pad 2', 106, 8, '#c7ccda');
      centerText('move  LEFT STICK / D-PAD', 124, 8, COL.hudText);
      centerText('load  X (hold)        throw  R1', 140, 8, COL.hudText);
    }

    for (var i = 0; i < 2; i++) {
      var col = players[i].color;
      var ready = players[i].ready;
      var prompt = scheme === 'keyboard' ? (i === 0 ? 'SPACE' : 'ENTER') : 'X';
      centerText('PLAYER ' + (i + 1) + ': ' + (ready ? 'READY!' : 'press ' + prompt),
        178 + i * 24, 10, ready ? COL.open : col);
    }
    centerText('Esc / O  to change controls', 276, 8, '#8890a8');
    centerText(Input.connectedCount() + ' gamepad(s) connected', 300, 8, '#8890a8');
  }

  function drawCountdown() {
    var shown = Math.ceil(countdownLeft - 1);
    centerText(shown > 0 ? String(shown) : 'GO!', CANVAS_H / 2, 40, shown > 0 ? COL.hudText : COL.open);
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    centerText('PAUSED', 96, 26, COL.hudText);
    for (var i = 0; i < PAUSE_OPTS.length; i++) {
      var sel = i === pauseSel;
      centerText((sel ? '> ' : '  ') + PAUSE_OPTS[i] + (sel ? ' <' : ''),
        152 + i * 30, 12, sel ? COL.open : '#5a6072');
    }
    centerText('up / down to choose    SPACE / X to select    Esc resumes', 286, 8, '#8890a8');
  }

  function drawWin() {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    var col = winner === 0 ? COL.p1 : COL.p2;
    centerText('PLAYER ' + (winner + 1), 110, 26, col);
    centerText(matchOver ? 'WINS THE MATCH!' : 'WINS THE ROUND', 148, 16, col);
    centerText('SERIES  ' + wins[0] + ' - ' + wins[1], 196, 12, COL.hudText);
    if (stateTime > 0.6) {
      centerText(matchOver ? 'press X for a new match' : 'press X for next round', 248, 10, '#8890a8');
    }
  }

  // ---- Canvas fitting --------------------------------------------------------
  function fitCanvas() {
    var scale = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
    if (scale >= 1) scale = Math.floor(scale);
    var w = Math.round(CANVAS_W * scale);
    var h = Math.round(CANVAS_H * scale);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var sc = document.getElementById('scanlines');
    sc.style.width = w + 'px';
    sc.style.height = h + 'px';
  }
  window.addEventListener('resize', fitCanvas);

  // ---- Main loop -------------------------------------------------------------
  var last = 0;
  function frame(now) {
    var dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (dt > 0.1) dt = 0.1;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    fitCanvas();
    Input.syncEdges();
    requestAnimationFrame(frame);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(boot);
    setTimeout(boot, 1500);
  } else {
    boot();
  }
})();
