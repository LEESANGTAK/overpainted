// Gamepad input (Steam Deck, Xbox/PlayStation pads) through the browser Gamepad API.
//
// The pad is polled every frame while one is connected. This module only turns raw buttons and
// sticks into named actions; app.js decides what they mean. Button numbers follow the "standard"
// mapping, which Chrome and Firefox use for Steam Deck and the usual pads:
//   0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 8 View/Back · 9 Menu/Start · 12–15 D-pad up/down/left/right
//
// Moves repeat while held: the first step at once, then after REPEAT_DELAY every REPEAT_EVERY ms.

const BUTTONS = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 8: 'view', 9: 'menu' };
const DPAD = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };
const DEAD = 0.5;           // stick has to lean this far to count as a direction
const REPEAT_DELAY = 260, REPEAT_EVERY = 110;

/**
 * Start listening. `on` receives:
 *   on.move(dx, dy)   a step of the cursor (D-pad or left stick)
 *   on.press(name)    'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'view' | 'menu'
 *   on.release(name)  when a button is let go
 *   on.connect(pad)   the first time a pad is seen
 */
export function startPad(on) {
  let frame = 0;
  const down = new Set();          // buttons held at the last poll
  let dir = null, nextRepeat = 0;  // the direction held, and when it steps again
  const seen = new Set();

  function poll(now) {
    frame = 0;
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(p => p && p.connected);
    if (!pads.length) return; // stop polling until the next gamepadconnected

    const held = new Set();
    let dx = 0, dy = 0;
    for (const p of pads) {
      if (!seen.has(p.index)) { seen.add(p.index); on.connect?.(p); }
      p.buttons.forEach((b, i) => {
        if (!b.pressed) return;
        if (BUTTONS[i]) held.add(BUTTONS[i]);
        if (DPAD[i]) { dx += DPAD[i][0]; dy += DPAD[i][1]; }
      });
      const [ax = 0, ay = 0] = p.axes;
      if (Math.abs(ax) > DEAD || Math.abs(ay) > DEAD) {
        // the stronger axis wins, so a slightly diagonal push still moves in a straight line
        if (Math.abs(ax) >= Math.abs(ay)) dx += Math.sign(ax); else dy += Math.sign(ay);
      }
    }
    for (const name of held) if (!down.has(name)) on.press(name);
    for (const name of down) if (!held.has(name)) on.release?.(name);
    down.clear(); for (const name of held) down.add(name);

    const d = dx || dy ? `${Math.sign(dx)},${Math.sign(dy)}` : null;
    if (d !== dir) {
      dir = d;
      if (d) { on.move(Math.sign(dx), Math.sign(dy)); nextRepeat = now + REPEAT_DELAY; }
    } else if (d && now >= nextRepeat) {
      on.move(Math.sign(dx), Math.sign(dy));
      nextRepeat = now + REPEAT_EVERY;
    }
    frame = requestAnimationFrame(poll);
  }
  const wake = () => { if (!frame) frame = requestAnimationFrame(poll); };
  window.addEventListener('gamepadconnected', wake);
  // a pad already connected before the page loaded shows up only after its first button press
  // (Chrome); polling once at start catches pads the browser already knows
  wake();
}
