# Trash Collector

A two-player split-screen 8-bit arcade game for the browser. Two garbage trucks
race down their own road, parking at dumpsters to load trash. Fill all 5 dumpsters
to unlock your finish line. First truck across wins.

## Play

Open `index.html` in a browser. No build step.

Connect two PlayStation controllers over Bluetooth, then on the title screen each
player presses Cross (✕) to ready up. A 3-2-1 countdown starts the race.

## Controls

| | Player 1 | Player 2 |
|---|---|---|
| Drive | Left stick / D-pad | Left stick / D-pad |
| Load trash | Cross (✕), held | Cross (✕), held |
| Throw hazard | R1 | R1 |
| Keyboard fallback | WASD + Space + E | Arrows + Enter + / |

Player 1 is the first connected controller (top panel), Player 2 the second
(bottom panel).

At the start screen, choose Keyboard or Gamepad (left/right, then Space/✕) and
the next screen shows that scheme's controls for both players. Two players is the
default — both must ready up to start. Press Escape (or Circle on a pad) during a
race to pause: resume, restart the round, or quit to the main menu.

## How to win

Drive into a dumpster's dashed parking bay, stop inside it, and hold ✕ until the
fill bar completes to bank that dumpster. Bank all 5 and your finish line turns
from LOCKED to OPEN. Reach the checkered gate on the right first to take the round.
First to two rounds wins the match.

The trucks accelerate and carry momentum, so line up your parking. Watch for:

- Groundhogs crossing the road. Hit one and your truck spins out for a second.
- Puddles that cut your grip and make you slide.
- Trash bags on the road. Drive over them for ammo (up to 3), then press R1 to lob
  a banana peel into your rival's lane. Hit it and they spin out.

Whoever is behind gets a small speed boost and the leader's lane draws more
groundhogs, so a round is rarely over until someone crosses.

## Files

- `index.html` — canvas + font + scripts
- `styles.css` — layout, pixelated scaling, scanline overlay
- `gamepad.js` — Gamepad API + keyboard input layer
- `game.js` — game loop, state machine, rendering, parking/loading logic, audio
