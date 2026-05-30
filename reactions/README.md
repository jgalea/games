# Reactions

A local multiplayer reaction game for PlayStation controllers, played in the browser. Two or more players, each with their own controller.

One controller is shown on screen. A button lights up with a beep, and the players race to press that exact button on their own controller. First correct press wins the round; the screen shows the winner and their reaction time, then the next round begins. Pressing the wrong button or jumping early locks you out of that round. First to the target score wins.

## How to play

1. Connect the controllers (DualShock 4 / DualSense; 8BitDo pads in D-input mode also work) over USB or Bluetooth.
2. Open `index.html` in Chrome (double-click it).
3. Pick a target score (1–20) and hit Next.
4. In the lobby, each player presses any button to join and gets a colour. Tap a name to edit it. Start when everyone's in (2+ players).
5. A 3-2-1 countdown, then play.

If the controllers don't show up when opening the file directly, serve it locally instead:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome.

Rounds advance on their own: after the winner reveal there's a short random pause, then the next button lights up. Background 8-bit music plays quietly and can be toggled with the speaker button in the top-right corner.

## Files

- `index.html` — the screens
- `styles.css` — layout and controller styling
- `gamepad.js` — reads the controllers via the Gamepad API
- `controller-svg.js` — the DualShock 4 artwork, embedded so it works offline
- `controller.js` — recolors the controller and lights up buttons
- `game.js` — game flow, scoring, sound, and music
- `assets/dualshock4.svg` — original controller drawing
