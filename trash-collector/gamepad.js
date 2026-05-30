// Input layer for two players. Each player reads from the Nth connected
// PlayStation controller (standard Gamepad API mapping) plus a keyboard
// fallback. Movement is an 8-way vector; the action button is Cross (✕).
//
// Standard mapping reference:
//   buttons[0]  = Cross / A
//   buttons[12..15] = D-pad up/down/left/right
//   axes[0], axes[1] = left stick X / Y

var Input = (function () {
  var keys = {};
  var DEAD = 0.35;

  // Player 0: WASD + Space + E(throw).  Player 1: arrows + Enter + /(throw).
  var KEYMAP = [
    { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space', toss: 'KeyE' },
    { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', action: 'Enter', toss: 'Slash' }
  ];

  var TOSS_BTN = 5; // R1 / right shoulder on standard mapping

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  function connectedPads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var out = [];
    for (var i = 0; i < pads.length; i++) if (pads[i]) out.push(pads[i]);
    return out;
  }

  function padFor(player) {
    return connectedPads()[player] || null;
  }

  function btn(pad, i) {
    var b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
  }

  // Normalised movement vector for a player, each component in [-1, 1].
  function move(player) {
    var x = 0, y = 0;
    var km = KEYMAP[player];
    if (keys[km.left]) x -= 1;
    if (keys[km.right]) x += 1;
    if (keys[km.up]) y -= 1;
    if (keys[km.down]) y += 1;

    var pad = padFor(player);
    if (pad) {
      var ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (Math.abs(ax) > DEAD) x += ax;
      if (Math.abs(ay) > DEAD) y += ay;
      if (btn(pad, 14)) x -= 1;
      if (btn(pad, 15)) x += 1;
      if (btn(pad, 12)) y -= 1;
      if (btn(pad, 13)) y += 1;
    }

    var len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x: x, y: y };
  }

  // Action held this frame (Cross or the player's keyboard action key).
  function action(player) {
    if (keys[KEYMAP[player].action]) return true;
    var pad = padFor(player);
    return pad ? btn(pad, 0) : false;
  }

  // Throw button held this frame (R1 or the player's keyboard toss key).
  function toss(player) {
    if (keys[KEYMAP[player].toss]) return true;
    var pad = padFor(player);
    return pad ? btn(pad, TOSS_BTN) : false;
  }

  // Edge-triggered action for menus. Call at most once per player per frame.
  var prevAction = [false, false];
  function actionPressed(player) {
    var now = action(player);
    var fired = now && !prevAction[player];
    prevAction[player] = now;
    return fired;
  }

  // Edge-triggered throw. Call at most once per player per frame.
  var prevToss = [false, false];
  function tossPressed(player) {
    var now = toss(player);
    var fired = now && !prevToss[player];
    prevToss[player] = now;
    return fired;
  }

  // Keep edge state fresh even when the pressed-helpers aren't polled (e.g. the
  // action button during the race), so returning to a menu doesn't misfire.
  function syncEdges() {
    prevAction[0] = action(0);
    prevAction[1] = action(1);
    prevToss[0] = toss(0);
    prevToss[1] = toss(1);
  }

  function connectedCount() { return connectedPads().length; }

  return {
    move: move,
    action: action,
    actionPressed: actionPressed,
    toss: toss,
    tossPressed: tossPressed,
    syncEdges: syncEdges,
    padFor: padFor,
    connectedCount: connectedCount
  };
})();
