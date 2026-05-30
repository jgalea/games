// Swimming Race — two-player top-down button-rhythm race.
// Alternate right hand (Circle) and left hand (Square) to stroke. Clean
// alternation builds speed; repeating the same hand wastes the press.
// First swimmer to touch the finish wall wins.
//
// States: select -> countdown -> racing -> finished
//   select: PlayStation-style join. Each controller moves left/right to pick a
//   lane and presses Cross to lock in. Lane 0 = left = Player 1, lane 1 = right.

(function () {
  "use strict";

  // ---- tuning ----------------------------------------------------------
  var STROKE_IMPULSE  = 0.030;  // velocity (track-fractions/sec) added per clean stroke
  var DRAG            = 1.5;    // exponential velocity decay per second (water resistance)
  var VEL_MAX         = 0.22;   // speed cap
  var COUNTDOWN_MS    = 3000;   // 3..2..1
  var GO_BANNER_MS    = 650;    // how long "GO!" flashes after the gun
  var FALSE_FREEZE_MS = 1000;   // penalty for a false start

  // Sharks. Identical in both lanes so the race stays fair. Each sweeps across
  // its lane; bump one and it eats you back to the start. y = fraction up the
  // track, w = angular sweep speed (sign sets direction), phase staggers them.
  var SHARKS = [
    { y: 0.24, w:  1.1, phase: 0.0 },
    { y: 0.42, w: -1.7, phase: 1.7 },
    { y: 0.60, w:  1.5, phase: 3.1 },
    { y: 0.78, w: -1.0, phase: 4.6 }
  ];
  var SHARK_HIT_X = 22;
  var SHARK_HIT_Y = 22;

  var STEER_SPEED = 0.85;       // top lateral speed (lane-fractions/sec) — gentle
  var STEER_ACCEL = 3.2;        // how quickly the swimmer eases toward that speed (inertia)
  var URCHIN_STUN_MS = 3000;    // caught on an urchin for 3..2..1 then back to start

  // Static sea urchins scattered across the whole lane, x and y as fractions
  // (0..1) of the swimmer's reachable area, so the edges hold urchins too and
  // hugging a wall is no free ride. One per height with gaps, so it's weavable.
  // Same layout in both lanes so it stays fair.
  var URCHINS = [
    { x: 0.10, y: 0.14 },
    { x: 0.55, y: 0.20 },
    { x: 0.88, y: 0.25 },
    { x: 0.30, y: 0.31 },
    { x: 0.00, y: 0.38 },
    { x: 0.65, y: 0.42 },
    { x: 0.42, y: 0.49 },
    { x: 1.00, y: 0.53 },
    { x: 0.20, y: 0.58 },
    { x: 0.78, y: 0.63 },
    { x: 0.50, y: 0.69 },
    { x: 0.08, y: 0.75 },
    { x: 0.92, y: 0.80 },
    { x: 0.38, y: 0.86 }
  ];
  var URCHIN_HIT_X = 22;
  var URCHIN_HIT_Y = 22;

  // PlayStation buttons (W3C Standard Gamepad mapping)
  var BTN_CROSS  = 0;   // lock in
  var BTN_CIRCLE = 1;   // right-hand stroke / unlock in select
  var BTN_SQUARE = 2;   // left-hand stroke
  var BTN_DLEFT  = 14;
  var BTN_DRIGHT = 15;

  // ---- canvas ----------------------------------------------------------
  var canvas = document.getElementById("pool");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- dom -------------------------------------------------------------
  var selectEl = document.getElementById("select");
  var statusEl = document.getElementById("selectStatus");
  var slotEl = [document.getElementById("slotLeft"), document.getElementById("slotRight")];
  var tokensEl = [document.getElementById("tokensLeft"), document.getElementById("tokensRight")];
  var TOKEN_COLORS = ["#4ea1ff", "#ff7a59", "#4fc4a8", "#ffd23f"];

  // ---- state -----------------------------------------------------------
  var state = "select";         // select | countdown | racing | finished
  var countdownStart = 0;
  var goTime = 0;
  var winner = -1;
  var players = [makePlayer(0), makePlayer(1)];

  // select-screen state
  var padState = {};            // gamepadIndex -> { order, side, locked }
  var joinCounter = 0;
  var readying = false;
  var padLane = {};             // gamepadIndex -> lane (0|1), set when the race starts

  // whales: a surprise hazard, generated once per race so both lanes match.
  // 1-2 per race, each crossing the lane diagonally, bigger and slower than sharks.
  var whales = [];

  function makePlayer(i) {
    return {
      index: i,
      color: i === 0 ? "#4ea1ff" : "#ff7a59",
      name: "Player " + (i + 1),
      pos: 0,                 // 0 = start, 1 = finish wall
      vel: 0,
      lastHand: null,         // 'R' | 'L'
      lx: 0,                  // lateral position in lane: -1 left edge .. +1 right edge
      lvel: 0,                // lateral velocity (eased for natural, drifting turns)
      strokeTimes: [],        // performance.now() of recent strokes (for rate display)
      armStroke: { R: -9999, L: -9999 }, // time of last sweep per arm
      activeArm: null,
      bob: 0,                 // body roll animation
      splashes: [],
      wake: [],
      falseStart: false,
      frozenUntil: 0,
      stunUntil: 0,           // caught on an urchin until this time (0 = free)
      urchinGraceUntil: 0,    // brief urchin immunity after a stun so you can pull away
      eatenFlash: -9999,      // time of last shark hit (for the red flash)
      finished: false,
      finishTime: 0
    };
  }

  // ---- select / join screen -------------------------------------------
  function enterSelect() {
    state = "select";
    padState = {};
    joinCounter = 0;
    readying = false;
    padLane = {};
    players = [makePlayer(0), makePlayer(1)];
    selectEl.classList.remove("hidden");
    renderSelect();
  }

  function sideLockedBy(side) {
    for (var gi in padState) {
      if (padState[gi].side === side && padState[gi].locked) return parseInt(gi, 10);
    }
    return null;
  }
  function sideHasPad(side) {
    for (var gi in padState) {
      if (padState[gi].side === side) return true;
    }
    return false;
  }

  function renderSelect() {
    var toks = ["", ""];
    var anyJoined = false;
    for (var gi in padState) {
      anyJoined = true;
      var s = padState[gi];
      var c = TOKEN_COLORS[(s.order - 1) % TOKEN_COLORS.length];
      toks[s.side] += '<span class="token' + (s.locked ? " locked" : "") +
        '" style="--c:' + c + '">🎮<b>' + s.order + "</b>" + (s.locked ? " ✓" : "") + "</span>";
    }
    tokensEl[0].innerHTML = toks[0];
    tokensEl[1].innerHTML = toks[1];
    slotEl[0].classList.toggle("locked", sideLockedBy(0) !== null);
    slotEl[1].classList.toggle("locked", sideLockedBy(1) !== null);

    if (readying) statusEl.textContent = "Diving in…";
    else if (!anyJoined) statusEl.textContent = "Press any button on a controller to join";
    else statusEl.textContent = "Move ← / → and press ✕ to lock into your lane";
  }

  function moveSide(gi, side) {
    var s = padState[gi];
    if (!s || s.locked || s.side === side) return;
    s.side = side;
    renderSelect();
  }

  function lockPad(gi) {
    var s = padState[gi];
    if (!s || s.locked) return;
    var occ = sideLockedBy(s.side);
    if (occ !== null && occ !== gi) {
      statusEl.textContent = "That lane is taken — move over";
      return;
    }
    s.locked = true;
    renderSelect();
    checkReady();
  }

  function unlockPad(gi) {
    var s = padState[gi];
    if (!s || !s.locked) return;
    s.locked = false;
    renderSelect();
  }

  function checkReady() {
    var a = sideLockedBy(0), b = sideLockedBy(1);
    if (a !== null && b !== null) {
      readying = true;
      padLane = {};
      padLane[a] = 0;
      padLane[b] = 1;
      renderSelect();
      setTimeout(startCountdown, 700);
    }
  }

  function handleSelect(e) {
    if (readying) return;
    var gi = e.gamepadIndex;
    var s = padState[gi];
    if (!s) {
      var side = sideHasPad(0) ? 1 : 0;   // first pad -> left, next -> the open lane
      padState[gi] = { order: ++joinCounter, side: side, locked: false };
      renderSelect();
      return;
    }
    switch (e.buttonIndex) {
      case BTN_DLEFT:  moveSide(gi, 0); break;
      case BTN_DRIGHT: moveSide(gi, 1); break;
      case BTN_CROSS:  lockPad(gi); break;
      case BTN_CIRCLE: unlockPad(gi); break;
    }
  }

  function handleSelectAxis(e) {
    if (state !== "select" || readying) return;
    if (!padState[e.gamepadIndex]) return;
    moveSide(e.gamepadIndex, e.dir < 0 ? 0 : 1);
  }

  // ---- race lifecycle --------------------------------------------------
  function startCountdown() {
    state = "countdown";
    countdownStart = performance.now();
    goTime = 0;
    winner = -1;
    players = [makePlayer(0), makePlayer(1)];
    makeWhales();
    selectEl.classList.add("hidden");
  }

  // 1-2 whales per race, staggered, each on its own diagonal path. Times are
  // offsets after GO; positions are lane fractions, so both lanes get the same
  // whale at the same moment.
  function makeWhales() {
    whales = [];
    var count = Math.random() < 0.5 ? 3 : 4;
    var prev = 0;
    for (var i = 0; i < count; i++) {
      var offset = prev + 1500 + Math.random() * 3000;
      prev = offset;
      var ltr = Math.random() < 0.5;
      var yS = 0.22 + Math.random() * 0.55;
      var yE = Math.max(0.15, Math.min(0.85, yS + (Math.random() - 0.5) * 0.7));
      whales.push({
        offset: offset,
        duration: 4800 + Math.random() * 2200,   // slow crossing
        xFrom: ltr ? -0.18 : 1.18,
        xTo:   ltr ? 1.18 : -0.18,
        yStart: yS,
        yEnd: yE
      });
    }
  }

  // ---- stroke input ----------------------------------------------------
  function handleStroke(lane, hand) {
    var p = players[lane];
    if (!p) return;
    var now = performance.now();

    if (state === "countdown") {
      if (!p.falseStart) p.falseStart = true;   // jumping the gun
      return;
    }
    if (state !== "racing" || p.finished) return;
    if (now < p.frozenUntil) return;                       // serving false-start penalty
    if (now < p.stunUntil) return;                         // caught on an urchin
    if (p.lastHand !== null && hand === p.lastHand) return; // same hand -> wasted

    // clean alternating stroke
    p.lastHand = hand;
    p.vel = Math.min(p.vel + STROKE_IMPULSE, VEL_MAX);
    p.strokeTimes.push(now);
    p.armStroke[hand] = now;
    p.activeArm = hand;
    spawnSplash(p, hand);
    spawnWake(p);
  }

  // gamepad routing
  Gamepads.onButtonDown(function (e) {
    if (state === "select") { handleSelect(e); return; }
    if (state === "finished") { startCountdown(); return; } // rematch, same lanes
    var lane = padLane[e.gamepadIndex];
    if (lane === undefined) return;                         // controller not in this race
    var hand = e.buttonIndex === BTN_CIRCLE ? "R"
             : e.buttonIndex === BTN_SQUARE ? "L" : null;
    if (hand) handleStroke(lane, hand);
  });
  Gamepads.onAxisFlick(handleSelectAxis);
  Gamepads.start();

  // keyboard fallback (testing): P1 F/J, P2 ArrowLeft/ArrowRight
  var KEYMAP = {
    KeyF: [0, "L"], KeyJ: [0, "R"],
    ArrowLeft: [1, "L"], ArrowRight: [1, "R"]
  };
  var keycodeEl = document.getElementById("keycode");
  window.addEventListener("keydown", function (e) {
    if (keycodeEl && !e.repeat) keycodeEl.textContent = "last key: " + e.code + " (keyCode " + e.keyCode + ")";
    if (LAT_KEYS[e.code]) { keysDown[e.code] = true; e.preventDefault(); return; }  // held steering
    if (e.repeat) return;
    if (state === "select") {
      if (e.code === "Enter" || e.code === "Space") { startCountdown(); e.preventDefault(); }
      return;
    }
    if (state === "finished") {
      if (e.code === "Enter" || e.code === "Space" || KEYMAP[e.code]) {
        startCountdown(); e.preventDefault();
      }
      return;
    }
    var m = KEYMAP[e.code];
    if (m) { handleStroke(m[0], m[1]); e.preventDefault(); }
  });
  window.addEventListener("keyup", function (e) {
    if (LAT_KEYS[e.code]) keysDown[e.code] = false;
  });

  // ---- particles -------------------------------------------------------
  function laneGeom(i) {
    var laneW = W / 2;
    var x0 = i * laneW;
    var cx = x0 + laneW / 2;
    var trackTop = 96;
    var trackBottom = H - 70;
    return { laneW: laneW, x0: x0, cx: cx, trackTop: trackTop,
             trackBottom: trackBottom, trackLen: trackBottom - trackTop };
  }
  function maxOff(g) { return g.laneW / 2 - 42; }     // how far the swimmer can slide from center
  function swimmerX(p, g) { return g.cx + p.lx * maxOff(g); }
  function swimmerXY(p) {
    var g = laneGeom(p.index);
    return { x: swimmerX(p, g), y: g.trackBottom - p.pos * g.trackLen, g: g };
  }
  function urchinXY(u, g) {
    return {
      x: g.cx + (2 * u.x - 1) * maxOff(g),   // u.x 0..1 spans the swimmer's reachable width
      y: g.trackBottom - u.y * g.trackLen
    };
  }
  function sharkPos(shark, g, now) {
    var t = now / 1000;
    var a = t * shark.w + shark.phase;
    var frac = 0.5 + 0.5 * Math.sin(a);            // 0..1 across the lane
    var vx = shark.w * Math.cos(a);                // sweep velocity (for facing)
    return {
      x: g.x0 + 34 + frac * (g.laneW - 68),
      y: g.trackBottom - shark.y * g.trackLen,
      face: vx >= 0 ? 1 : -1
    };
  }
  function whalePos(whale, g, now) {
    if (goTime <= 0) return null;
    var st = goTime + whale.offset;
    if (now < st || now > st + whale.duration) return null;
    var u = (now - st) / whale.duration;
    var xf = whale.xFrom + (whale.xTo - whale.xFrom) * u;
    var yf = whale.yStart + (whale.yEnd - whale.yStart) * u;
    var dx = (whale.xTo - whale.xFrom) * g.laneW;
    var dy = -(whale.yEnd - whale.yStart) * g.trackLen;
    return {
      x: g.x0 + xf * g.laneW,
      y: g.trackBottom - yf * g.trackLen,
      angle: Math.atan2(dy, dx)
    };
  }
  function spawnSplash(p, hand) {
    var s = swimmerXY(p);
    var side = hand === "R" ? 1 : -1;
    var ox = s.x + side * 16;
    var oy = s.y - 6;
    for (var k = 0; k < 7; k++) {
      p.splashes.push({
        x: ox, y: oy,
        vx: side * (20 + Math.random() * 60) + (Math.random() - 0.5) * 30,
        vy: -40 - Math.random() * 70,
        life: 1
      });
    }
  }
  function spawnWake(p) {
    var s = swimmerXY(p);
    p.wake.push({ x: s.x, y: s.y + 18, r: 6, life: 1 });
    if (p.wake.length > 28) p.wake.shift();
  }

  function hitsShark(p, now) {
    var g = laneGeom(p.index);
    var sx = swimmerX(p, g), sy = g.trackBottom - p.pos * g.trackLen;
    for (var i = 0; i < SHARKS.length; i++) {
      var s = sharkPos(SHARKS[i], g, now);
      if (Math.abs(sx - s.x) < SHARK_HIT_X && Math.abs(sy - s.y) < SHARK_HIT_Y) return true;
    }
    return false;
  }
  function hitsWhale(p, now) {
    var g = laneGeom(p.index);
    var sx = swimmerX(p, g), sy = g.trackBottom - p.pos * g.trackLen;
    for (var i = 0; i < whales.length; i++) {
      var w = whalePos(whales[i], g, now);
      if (w && Math.abs(sx - w.x) < 36 && Math.abs(sy - w.y) < 24) return true;
    }
    return false;
  }
  function hitsUrchin(p) {
    var g = laneGeom(p.index);
    var sx = swimmerX(p, g), sy = g.trackBottom - p.pos * g.trackLen;
    for (var i = 0; i < URCHINS.length; i++) {
      var u = urchinXY(URCHINS[i], g);
      if (Math.abs(sx - u.x) < URCHIN_HIT_X && Math.abs(sy - u.y) < URCHIN_HIT_Y) return true;
    }
    return false;
  }
  function eatPlayer(p, now) {
    p.pos = 0;
    p.vel = 0;
    p.lx = 0;
    p.lvel = 0;
    p.lastHand = null;
    p.strokeTimes = [];
    p.eatenFlash = now;
  }

  // steering input: analog left stick for the lane's controller, plus held keys
  function padForLane(lane) {
    for (var gi in padLane) { if (padLane[gi] === lane) return parseInt(gi, 10); }
    return -1;
  }
  function padAxisX(gi) {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var p = pads[gi];
    if (!p || !p.axes || !p.axes.length) return 0;
    var x = p.axes[0];
    return Math.abs(x) > 0.18 ? x : 0;   // deadzone
  }
  var keysDown = {};
  var LAT_KEYS = { KeyA: [0, -1], KeyD: [0, 1], KeyK: [1, -1], KeyL: [1, 1] };
  function keyboardSteer(lane) {
    var s = 0;
    for (var code in LAT_KEYS) {
      if (keysDown[code] && LAT_KEYS[code][0] === lane) s += LAT_KEYS[code][1];
    }
    return s;
  }
  function steerInput(lane) {
    var gi = padForLane(lane);
    var stick = gi >= 0 ? padAxisX(gi) : 0;
    return stick !== 0 ? stick : keyboardSteer(lane);
  }

  // ---- update ----------------------------------------------------------
  function update(dt, now) {
    if (state === "countdown" && now - countdownStart >= COUNTDOWN_MS) {
      state = "racing";
      goTime = now;
      for (var i = 0; i < players.length; i++) {
        if (players[i].falseStart) players[i].frozenUntil = now + FALSE_FREEZE_MS;
      }
    }

    for (var p = 0; p < players.length; p++) {
      var pl = players[p];

      if (state === "racing" && !pl.finished) {
        if (now < pl.stunUntil) {
          pl.vel = 0;                 // caught on an urchin, frozen in place
        } else {
          if (pl.stunUntil !== 0) {   // stun just ended -> nudge to the side and carry on
            pl.stunUntil = 0;
            pl.vel = 0; pl.lvel = 0;
            pl.lx += (pl.lx <= 0 ? 1 : -1) * 0.42;   // slide clear of the urchin
            if (pl.lx < -1) pl.lx = -1; if (pl.lx > 1) pl.lx = 1;
            pl.urchinGraceUntil = now + 900;          // don't instantly re-snag
          }
          // steer across the lane — ease toward the input so turns are gradual,
          // and the swimmer keeps drifting (and moving diagonally) after you let go
          pl.lvel += (steerInput(pl.index) - pl.lvel) * Math.min(1, dt * STEER_ACCEL);
          pl.lx += pl.lvel * STEER_SPEED * dt;
          if (pl.lx < -1) { pl.lx = -1; pl.lvel = 0; }
          if (pl.lx > 1) { pl.lx = 1; pl.lvel = 0; }
          // forward
          pl.vel -= pl.vel * DRAG * dt;
          if (pl.vel < 0) pl.vel = 0;
          pl.pos += pl.vel * dt;
          if (pl.pos >= 1) {
            pl.pos = 1;
            pl.finished = true;
            pl.finishTime = (now - goTime) / 1000;
            if (winner === -1) { winner = pl.index; state = "finished"; }
          } else if (pl.pos > 0.02 && (hitsShark(pl, now) || hitsWhale(pl, now))) {
            eatPlayer(pl, now);
          } else if (pl.pos > 0.02 && now >= pl.urchinGraceUntil && hitsUrchin(pl)) {
            pl.stunUntil = now + URCHIN_STUN_MS;   // 3s stuck, then carry on from here
            pl.vel = 0;
          }
        }
      }

      var target = pl.activeArm === "R" ? 1 : pl.activeArm === "L" ? -1 : 0;
      pl.bob += (target - pl.bob) * Math.min(1, dt * 12);

      while (pl.strokeTimes.length && now - pl.strokeTimes[0] > 1000) pl.strokeTimes.shift();

      for (var s = pl.splashes.length - 1; s >= 0; s--) {
        var sp = pl.splashes[s];
        sp.vy += 320 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.life -= dt * 1.8;
        if (sp.life <= 0) pl.splashes.splice(s, 1);
      }
      for (var w = pl.wake.length - 1; w >= 0; w--) {
        var wk = pl.wake[w];
        wk.life -= dt * 0.9;
        wk.r += dt * 14;
        if (wk.life <= 0) pl.wake.splice(w, 1);
      }
    }
  }

  // ---- render ----------------------------------------------------------
  function render(now) {
    ctx.clearRect(0, 0, W, H);
    drawLane(0, now);
    drawLane(1, now);
    drawDivider();
    if (state === "countdown" || (state === "racing" && now - goTime < GO_BANNER_MS)) {
      drawCountdown(now);
    }
    if (state === "finished") drawFinish();
  }

  function drawLane(i, now) {
    var g = laneGeom(i);
    var p = players[i];

    var grad = ctx.createLinearGradient(0, g.trackTop, 0, g.trackBottom);
    if (i === 0) { grad.addColorStop(0, "#0b3a63"); grad.addColorStop(1, "#0a2c4e"); }
    else { grad.addColorStop(0, "#0e3a5a"); grad.addColorStop(1, "#0c2740"); }
    ctx.fillStyle = grad;
    ctx.fillRect(g.x0, 0, g.laneW, H);

    // scrolling ripple lines (convey forward motion)
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x0, g.trackTop, g.laneW, g.trackLen);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    var scroll = (p.pos * g.trackLen) % 46;
    for (var y = g.trackTop - 46 + scroll; y < g.trackBottom + 46; y += 46) {
      ctx.beginPath();
      ctx.moveTo(g.x0 + 10, y);
      ctx.lineTo(g.x0 + g.laneW - 10, y);
      ctx.stroke();
    }
    ctx.restore();

    drawRope(g.x0 + 9, g.trackTop, g.trackBottom);
    drawRope(g.x0 + g.laneW - 9, g.trackTop, g.trackBottom);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.x0 + 12, g.trackBottom);
    ctx.lineTo(g.x0 + g.laneW - 12, g.trackBottom);
    ctx.stroke();

    drawFinishWall(g);
    drawUrchins(g);
    drawWake(p);
    drawSwimmer(p, now);
    drawSplashes(p);
    drawSharks(g, now);
    drawWhales(g, now);
    drawHud(i, g, p);

    // 3-2-1 hold while caught on an urchin
    if (now < p.stunUntil) {
      var sxy = swimmerXY(p);
      var n = Math.ceil((p.stunUntil - now) / 1000);
      ctx.fillStyle = "#ffd23f";
      ctx.font = "800 44px -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(n), sxy.x, sxy.y - 34);
      ctx.fillStyle = "rgba(255,210,63,0.9)";
      ctx.font = "700 14px -apple-system, Segoe UI, sans-serif";
      ctx.fillText("ouch! urchin", sxy.x, sxy.y - 64);
    }

    // red flash + label when a shark just ate this swimmer
    var since = now - p.eatenFlash;
    if (since < 700) {
      var a = 0.55 * (1 - since / 700);
      ctx.fillStyle = "rgba(255,45,45," + a.toFixed(3) + ")";
      ctx.fillRect(g.x0, g.trackTop, g.laneW, g.trackLen);
      ctx.fillStyle = "rgba(255,255,255," + (1 - since / 700).toFixed(3) + ")";
      ctx.font = "800 34px -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("CHOMP! Back to start", g.cx, g.trackBottom - 40);
    }
  }

  function drawSharks(g, now) {
    for (var i = 0; i < SHARKS.length; i++) {
      var s = sharkPos(SHARKS[i], g, now);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(s.face, 1);   // nose points the way it swims

      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, 4, 24, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // tail
      ctx.fillStyle = "#5d6b7d";
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.lineTo(-33, -11);
      ctx.lineTo(-33, 11);
      ctx.closePath();
      ctx.fill();

      // body
      ctx.fillStyle = "#7c8a9c";
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // lighter belly
      ctx.fillStyle = "rgba(220,228,236,0.55)";
      ctx.beginPath();
      ctx.ellipse(2, 3, 16, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // dorsal fin
      ctx.fillStyle = "#5d6b7d";
      ctx.beginPath();
      ctx.moveTo(-2, -7);
      ctx.lineTo(5, -20);
      ctx.lineTo(11, -7);
      ctx.closePath();
      ctx.fill();
      // pectoral fin
      ctx.beginPath();
      ctx.moveTo(2, 6);
      ctx.lineTo(10, 16);
      ctx.lineTo(14, 6);
      ctx.closePath();
      ctx.fill();

      // eye + gills
      ctx.fillStyle = "#10161d";
      ctx.beginPath();
      ctx.arc(13, -2, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(40,52,66,0.7)";
      ctx.lineWidth = 1.5;
      for (var k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(5 - k * 4, -5);
        ctx.lineTo(5 - k * 4, 5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawRope(x, top, bottom) {
    for (var y = top; y < bottom; y += 18) {
      ctx.fillStyle = (Math.floor(y / 18) % 2) ? "#e23d52" : "#f5f7fb";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFinishWall(g) {
    var h = 16, cols = 16, cw = (g.laneW - 24) / cols;
    for (var c = 0; c < cols; c++) {
      ctx.fillStyle = (c % 2) ? "#0a1622" : "#f5f7fb";
      ctx.fillRect(g.x0 + 12 + c * cw, g.trackTop - h, cw, h);
    }
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(g.x0 + 12, g.trackTop - 2, g.laneW - 24, 3);
  }

  function drawWake(p) {
    for (var i = 0; i < p.wake.length; i++) {
      var wk = p.wake[i];
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255," + (0.10 * wk.life).toFixed(3) + ")";
      ctx.arc(wk.x, wk.y, wk.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSplashes(p) {
    for (var i = 0; i < p.splashes.length; i++) {
      var s = p.splashes[i];
      ctx.beginPath();
      ctx.fillStyle = "rgba(220,240,255," + Math.max(0, s.life).toFixed(3) + ")";
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // top-down swimmer: two stroking arms, torso, head at the front (up)
  function drawSwimmer(p, now) {
    var s = swimmerXY(p);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(p.bob * 0.12);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 4, 15, 26, 0, 0, Math.PI * 2);
    ctx.fill();

    drawArm(p, "R", now);
    drawArm(p, "L", now);

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(-13, -2, 26, 4);

    ctx.fillStyle = "#f0c79a";
    ctx.beginPath();
    ctx.arc(0, -24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, -25, 8, Math.PI, 0);
    ctx.fill();

    ctx.restore();
  }

  // arm sweeps from forward (reach, up) to back (pull, down-and-out) over a stroke
  function drawArm(p, hand, now) {
    var s = hand === "R" ? 1 : -1;
    var t = (now - p.armStroke[hand]) / 300;
    if (t < 0) t = 0; if (t > 1) t = 1;
    var theta = (25 + t * 125) * Math.PI / 180;   // 25deg forward -> 150deg back
    var dirX = s * Math.sin(theta);
    var dirY = -Math.cos(theta);
    var len = 20;
    var shX = s * 9, shY = -4;                     // shoulder
    var hX = shX + dirX * len, hY = shY + dirY * len;
    ctx.strokeStyle = "#f0c79a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(hX, hY);
    ctx.stroke();
    // hand
    ctx.fillStyle = "#f0c79a";
    ctx.beginPath();
    ctx.arc(hX, hY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWhales(g, now) {
    for (var i = 0; i < whales.length; i++) {
      var w = whalePos(whales[i], g, now);
      if (!w) continue;
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.angle);
      if (Math.cos(w.angle) < 0) ctx.scale(1, -1);   // keep belly down when heading left

      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(0, 7, 44, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      // tail fluke (rear)
      ctx.fillStyle = "#2f4a63";
      ctx.beginPath();
      ctx.moveTo(-36, 0);
      ctx.lineTo(-56, -15);
      ctx.lineTo(-46, 0);
      ctx.lineTo(-56, 15);
      ctx.closePath();
      ctx.fill();

      // body
      ctx.fillStyle = "#3f5d78";
      ctx.beginPath();
      ctx.ellipse(0, 0, 40, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      // belly
      ctx.fillStyle = "rgba(196,214,228,0.6)";
      ctx.beginPath();
      ctx.ellipse(5, 6, 30, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // pectoral fin
      ctx.fillStyle = "#2f4a63";
      ctx.beginPath();
      ctx.moveTo(3, 9);
      ctx.lineTo(17, 26);
      ctx.lineTo(23, 9);
      ctx.closePath();
      ctx.fill();

      // eye (front)
      ctx.fillStyle = "#10161d";
      ctx.beginPath();
      ctx.arc(29, -3, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawUrchins(g) {
    for (var i = 0; i < URCHINS.length; i++) {
      var u = urchinXY(URCHINS[i], g);
      ctx.save();
      ctx.translate(u.x, u.y);

      // spikes
      ctx.strokeStyle = "#2a2138";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (var k = 0; k < 12; k++) {
        var a = (k / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
        ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
        ctx.stroke();
      }
      // body
      ctx.fillStyle = "#3a2d52";
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a4488";
      ctx.beginPath();
      ctx.arc(-2, -2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHud(i, g, p) {
    ctx.fillStyle = p.color;
    ctx.font = "700 22px -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name, g.cx, 34);

    ctx.fillStyle = "#cfe2ff";
    ctx.font = "600 15px -apple-system, Segoe UI, sans-serif";
    ctx.fillText(p.strokeTimes.length + " strokes/s", g.cx, 58);

    var now = performance.now();
    if (state === "racing" && now < p.frozenUntil) {
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "800 18px -apple-system, Segoe UI, sans-serif";
      ctx.fillText("FALSE START!", g.cx, 80);
    }

    var barX = i === 0 ? g.x0 + 22 : g.x0 + g.laneW - 22;
    var top = g.trackTop, bot = g.trackBottom;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(barX, bot); ctx.lineTo(barX, top); ctx.stroke();
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(barX, bot);
    ctx.lineTo(barX, bot - p.pos * (bot - top));
    ctx.stroke();
  }

  function drawDivider() {
    ctx.fillStyle = "#02080f";
    ctx.fillRect(W / 2 - 2, 0, 4, H);
  }

  function drawCountdown(now) {
    var label, color = "#ffffff";
    if (state === "countdown") {
      label = String(Math.ceil((COUNTDOWN_MS - (now - countdownStart)) / 1000));
    } else {
      label = "GO!";
      color = "#6bdc8a";
    }
    ctx.save();
    ctx.fillStyle = "rgba(3,10,18,0.45)";
    ctx.fillRect(0, H / 2 - 90, W, 180);
    ctx.fillStyle = color;
    ctx.font = "800 130px -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, H / 2);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  function drawFinish() {
    var win = players[winner];
    ctx.save();
    ctx.fillStyle = "rgba(3,10,18,0.78)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd23f";
    ctx.font = "800 26px -apple-system, Segoe UI, sans-serif";
    ctx.fillText("🏆", W / 2, H / 2 - 120);

    ctx.fillStyle = win.color;
    ctx.font = "800 64px -apple-system, Segoe UI, sans-serif";
    ctx.fillText(win.name + " wins!", W / 2, H / 2 - 40);

    ctx.fillStyle = "#cfe2ff";
    ctx.font = "600 28px -apple-system, Segoe UI, sans-serif";
    ctx.fillText(win.finishTime.toFixed(2) + "s", W / 2, H / 2 + 14);

    ctx.fillStyle = "#9fb6d6";
    ctx.font = "600 20px -apple-system, Segoe UI, sans-serif";
    ctx.fillText("Press any button to race again", W / 2, H / 2 + 70);
    ctx.restore();
  }

  // ---- loop ------------------------------------------------------------
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt, now);
    render(now);
    requestAnimationFrame(frame);
  }

  enterSelect();
  requestAnimationFrame(frame);
})();
