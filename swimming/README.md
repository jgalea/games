# Swimming Race

A two-player, head-to-head swimming race for the browser. Plug in two
PlayStation controllers, split the screen, and out-stroke your opponent to
the wall.

## How to play

Open `index.html` in a browser. On the lane-select screen, press any button on
a controller to join, move it `←` / `→` to choose a lane, and press `✕` to lock
in (`◯` unlocks). Once both lanes are claimed the race starts.

Each swimmer is powered by alternating their two hands:

- **◯ Circle** = right-hand stroke
- **▢ Square** = left-hand stroke

You have to alternate cleanly — Circle, Square, Circle, Square. Mashing the
same button twice does nothing; only a clean change of hands pulls you
forward. The faster you keep the rhythm, the faster you swim. Stop stroking
and water drag glides you to a halt.

Sharks patrol the lane, sweeping side to side. Bump one and it eats you back
to the start, so time your strokes to slip past while it's off to the side.
The shark pattern is identical in both lanes, so the race stays fair.

After a 3-2-1-GO countdown, the first swimmer to touch the finish wall wins.
Jump the gun and you get a one-second false-start freeze.

Player 1 is the left lane (gamepad 1), Player 2 the right lane (gamepad 2).

## Keyboard (testing)

No controllers handy? Player 1 uses `F` / `J`, Player 2 uses `←` / `→`.

## Files

- `index.html` — title screen and canvas
- `game.js` — race logic and top-down rendering
- `gamepad.js` — Gamepad API polling
- `styles.css` — title-screen styling

No build step, no dependencies.

## Tuning

The feel lives in a few constants at the top of `game.js`: `STROKE_IMPULSE`
(push per stroke), `DRAG` (how fast you slow down), and `VEL_MAX` (speed cap).
The `SHARKS` array sets each shark's height, sweep speed, and phase.
