// Renders the DualShock 4 artwork (embedded in controller-svg.js), recolors it
// white with colorful buttons, and overlays a glow that lights up one button.

var Controller = (function () {

  // Button positions as a fraction of the 600x400 artwork, plus glow color.
  var BUTTONS = {
    triangle: { x: 78.7, y: 20.5,  color: '#4fc4a8' },
    circle:   { x: 85.5, y: 31.25, color: '#ef5b6b' },
    square:   { x: 72.0, y: 31.25, color: '#d96fc4' },
    cross:    { x: 78.7, y: 41.25, color: '#5b8def' },
    up:       { x: 21.7, y: 18.0,  color: '#ffd23f' },
    down:     { x: 21.3, y: 44.75, color: '#ffd23f' },
    left:     { x: 12.7, y: 31.25, color: '#ffd23f' },
    right:    { x: 30.3, y: 31.25, color: '#ffd23f' }
  };

  // Artwork element ids: face-button discs and their symbols.
  var DISC = { triangle: 'path3038', circle: 'path3038-6', square: 'path3038-4', cross: 'path3038-1' };
  var SYM  = { triangle: 'rect4554-1', circle: 'path4552', square: 'rect4554', cross: 'path4532' };

  // PlayStation symbol colours (green / red / pink / light blue).
  var SYM_COLORS = { triangle: '#3bb38c', circle: '#e8546a', square: '#df73c0', cross: '#57b5e8' };

  function pick(container, id) { return container.querySelector('[id="' + id + '"]'); }

  function build(container) {
    var glows = '';
    for (var id in BUTTONS) {
      var b = BUTTONS[id];
      glows += '<span class="glow" data-btn="' + id + '" style="left:' + b.x +
               '%;top:' + b.y + '%;--glow:' + b.color + '"></span>';
    }
    container.innerHTML =
      '<div class="pad-wrap">' + window.DUALSHOCK_SVG +
      '<div class="glows">' + glows + '</div></div>';

    var svg = container.querySelector('svg');
    svg.classList.add('pad-svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 600 400');

    // Recolor to match a real Glacier White DualShock 4.
    // Grey body -> warm white, black outlines -> soft grey seams (overrides inline styles).
    var shapes = svg.querySelectorAll('path, rect, circle, ellipse, polygon');
    for (var i = 0; i < shapes.length; i++) {
      var cs = getComputedStyle(shapes[i]);
      if (cs.fill === 'rgb(204, 204, 204)') shapes[i].style.fill = '#f1f1ec';
      if (cs.stroke === 'rgb(0, 0, 0)') shapes[i].style.stroke = '#c2c1bb';
    }

    // Dark accents: charcoal sticks in a white recess, glossy-black touchpad.
    var tone = {
      'path4031': '#1c1d20',   'path4031-7': '#1c1d20',        // stick tops (near-black centre)
      'path4031-3': '#34353a', 'path4031-3-2': '#34353a',      // stick bodies (dark grey)
      'path4031-4': '#eceae4', 'path4031-4-7': '#eceae4',      // stick recess (white)
      'rect3842-7': '#2a2b30', 'rect3842': '#191a1e', 'rect3842-4-9': '#161619', // touchpad (black)
      'path4166-3': '#f1f1ec', // D-pad disc -> white background (the dark cross is drawn over it below)
      'path2995': '#26272b', 'path2995-7': '#26272b' // Share / Options buttons (black)
    };
    for (var id in tone) {
      var t = pick(container, id);
      if (t) t.style.fill = tone[id];
    }

    // Face buttons: black bodies with the classic coloured symbols.
    for (var k in DISC) {
      var disc = pick(container, DISC[k]);
      if (disc) { disc.style.fill = '#26272b'; disc.style.stroke = 'rgba(0,0,0,.35)'; }
      var sym = pick(container, SYM[k]);
      if (sym) { sym.style.fill = SYM_COLORS[k]; sym.style.stroke = SYM_COLORS[k]; }
    }
    // The X is two separate strokes; colour the second line too.
    var xLine2 = pick(container, 'path4532-0');
    if (xLine2) { xLine2.style.fill = SYM_COLORS.cross; xLine2.style.stroke = SYM_COLORS.cross; }

    // D-pad: the artwork's cross is a hole in a dark disc. Paint the disc white and
    // drop its outline, then lay a clean dark-grey cross over it so the *buttons* are
    // grey on a white background. Keep the arrow glyphs white on top.
    var dpadDisc = pick(container, 'path4166-3');
    if (dpadDisc) {
      dpadDisc.style.stroke = 'none';
      var arm = function (x, y, w, h) {
        var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('rx', 10); r.setAttribute('fill', '#26272b');
        return r;
      };
      var vert = arm(113, 68, 34, 114);
      var horz = arm(72, 108, 116, 34);
      dpadDisc.parentNode.insertBefore(vert, dpadDisc.nextSibling);
      dpadDisc.parentNode.insertBefore(horz, vert.nextSibling);
      // faint embossed arrows on the black cross (subtle, not white)
      ['rect3996', 'rect3996-2', 'rect3996-3', 'rect3996-7'].forEach(function (aid) {
        var a = pick(container, aid);
        if (a) { a.style.fill = '#4a4b52'; a.style.stroke = 'none'; }
      });
    }

    // PS button: white logo on a black circular button (add the black disc behind it).
    var psLogo = pick(container, 'path3840');
    if (psLogo) {
      var disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      disc.setAttribute('cx', '300');
      disc.setAttribute('cy', '203');
      disc.setAttribute('r', '17');
      disc.setAttribute('fill', '#0c0c0e');
      psLogo.parentNode.insertBefore(disc, psLogo);
      psLogo.style.fill = '#ffffff';
      psLogo.style.stroke = '#ffffff';
    }
  }

  function highlight(container, btnId) {
    clear(container);
    var g = container.querySelector('.glow[data-btn="' + btnId + '"]');
    if (g) g.classList.add('flash');
  }

  function clear(container) {
    var lit = container.querySelectorAll('.glow.flash');
    for (var i = 0; i < lit.length; i++) lit[i].classList.remove('flash');
  }

  return { build: build, highlight: highlight, clear: clear };
})();
