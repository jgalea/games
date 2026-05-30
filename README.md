# Games

A small collection of local-multiplayer browser games built to be played with
PlayStation controllers over Bluetooth. Each one is plain HTML, CSS, and
JavaScript with no build step. Open any game's `index.html` in a browser, pair
your controllers, and play.

## Games

- [trash-collector](trash-collector/) — Two-player split-screen 8-bit racer.
  Drive a garbage truck, park in bays to load dumpsters, dodge groundhogs and
  puddles, and lob banana peels into your rival's lane. Best of three.
- [swimming](swimming/) — Two-player head-to-head swimming race. Alternate the
  Circle and Square buttons in a clean rhythm to out-stroke your opponent to
  the wall.
- [reactions](reactions/) — Local multiplayer reaction game. A button lights up
  on screen; race to press it on your own controller. First to the target score
  wins.

## Controllers

The games read controllers through the browser Gamepad API. Pair your
controller over Bluetooth, open the game, and press a button once so the browser
registers it. Each game also has a keyboard fallback for testing solo (see the
game's own README).
