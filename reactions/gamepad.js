// Reads PlayStation controllers via the Gamepad API.
// The API has no input events, so we poll every animation frame and report
// button up->down transitions and left-stick left/right "flicks".

var Gamepads = (function () {
  var btnListeners = [];
  var axisListeners = [];
  var prev = {};        // gamepadIndex -> { buttonIndex: wasPressed }
  var prevZone = {};    // gamepadIndex -> -1 | 0 | 1 (left-stick horizontal zone)
  var running = false;

  function onButtonDown(cb) { btnListeners.push(cb); }
  function onAxisFlick(cb)  { axisListeners.push(cb); }

  function connectedCount() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var n = 0;
    for (var i = 0; i < pads.length; i++) if (pads[i]) n++;
    return n;
  }

  function poll() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var p = 0; p < pads.length; p++) {
      var pad = pads[p];
      if (!pad) continue;

      // buttons
      var before = prev[pad.index] || {};
      var now = {};
      for (var b = 0; b < pad.buttons.length; b++) {
        var btn = pad.buttons[b];
        var pressed = btn.pressed || btn.value > 0.5;
        now[b] = pressed;
        if (pressed && !before[b]) {
          var evt = { gamepadIndex: pad.index, buttonIndex: b, time: performance.now() };
          for (var l = 0; l < btnListeners.length; l++) btnListeners[l](evt);
        }
      }
      prev[pad.index] = now;

      // left-stick horizontal flick
      var x = pad.axes && pad.axes.length ? pad.axes[0] : 0;
      var zone = x < -0.5 ? -1 : (x > 0.5 ? 1 : 0);
      var pz = prevZone[pad.index] || 0;
      if (zone !== pz && zone !== 0) {
        for (var a = 0; a < axisListeners.length; a++) {
          axisListeners[a]({ gamepadIndex: pad.index, dir: zone });
        }
      }
      prevZone[pad.index] = zone;
    }
    requestAnimationFrame(poll);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(poll);
  }

  return {
    onButtonDown: onButtonDown,
    onAxisFlick: onAxisFlick,
    connectedCount: connectedCount,
    start: start
  };
})();
