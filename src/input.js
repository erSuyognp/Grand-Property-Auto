// One place for driving input: keyboard, gamepad and the phone controller all feed the same
// {throttle, steer, handbrake, boost} state. Discrete actions go out as events.
export function createInput(ctx) {
  const keys = new Set();
  const phone = { active: false, steer: 0, gas: 0, brake: 0, last: 0 };
  const auto = { active: false, throttle: 0, steer: 0, handbrake: false };
  let padPrev = [];
  let enabled = true;

  const typing = (e) => /INPUT|TEXTAREA/.test(e.target?.tagName || '');
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) ctx.emit('key', e.code, e);
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    ctx.emit('keyup', e.code, e);
  });
  addEventListener('blur', () => keys.clear());

  const PAD_ACTIONS = { 0: 'KeyE', 1: 'Escape', 2: 'KeyF', 3: 'KeyC', 9: 'Enter', 8: 'Tab', 4: 'KeyV', 5: 'KeyR' };

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      p.buttons.forEach((b, i) => {
        if (b.pressed && !padPrev[i] && PAD_ACTIONS[i]) ctx.emit('key', PAD_ACTIONS[i], null);
        if (!b.pressed && padPrev[i] && PAD_ACTIONS[i]) ctx.emit('keyup', PAD_ACTIONS[i], null);
      });
      padPrev = p.buttons.map((b) => b.pressed);
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      return {
        steer: -dz(p.axes[0] || 0),
        throttle: (p.buttons[7]?.value || 0) - (p.buttons[6]?.value || 0),
        handbrake: !!p.buttons[1]?.pressed && false,
        boost: !!p.buttons[2]?.pressed && false,
      };
    }
    return null;
  }

  return {
    keys, phone, auto,
    setEnabled(v) { enabled = v; },
    get() {
      const pad = readPad();
      if (!enabled) return { throttle: 0, steer: 0, handbrake: true, boost: false };
      if (auto.active) return { throttle: auto.throttle, steer: auto.steer, handbrake: auto.handbrake, boost: false };
      const k = (c) => keys.has(c);
      let throttle = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
      let steer = (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0);
      let handbrake = k('Space');
      let boost = k('ShiftLeft') || k('ShiftRight');
      if (pad) {
        if (Math.abs(pad.throttle) > Math.abs(throttle)) throttle = pad.throttle;
        if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
      }
      if (phone.active && performance.now() - phone.last < 1500) {
        const pt = phone.gas - phone.brake;
        if (Math.abs(pt) > Math.abs(throttle)) throttle = pt;
        if (Math.abs(phone.steer) > Math.abs(steer)) steer = phone.steer;
      }
      return { throttle, steer, handbrake, boost };
    },
  };
}
