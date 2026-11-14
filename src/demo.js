// Demo mode (press 0): an autopilot run for the backup video. A canned voice line starts a
// mission, the car drives the gold line, narration plays on arrival, it walks inside for ten
// seconds, exits, rates the home, asks for "something cheaper" and goes again. Works with
// the server stopped and the network off.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function initDemo(ctx) {
  const D = { running: false, token: 0, step: '', loops: 0, log: [] };
  const LINES = ['three bedrooms under 900k with a pool', 'something cheaper', 'closer to a park'];
  const fast = () => ctx.params.has('demofast');

  function mark(step) { D.step = step; D.log.push(step); window.__gpa.demo = { step, loops: D.loops, log: D.log, running: D.running }; ctx.emit('demo-step', step); }

  async function sayLine(text, token) {
    // show it the way live speech shows up: words arriving in the caption bar
    const words = text.split(' ');
    for (let i = 1; i <= words.length; i++) {
      if (token !== D.token) return;
      ctx.hud.live(words.slice(0, i).join(' '));
      await wait(fast() ? 20 : 130);
    }
    await wait(fast() ? 50 : 500);
    ctx.hud.live(null);
    await ctx.missions.handle(text);
  }

  function drive() {
    const a = ctx.input.auto, s = ctx.car.state;
    const route = ctx.missions.route;
    if (!route || route.length < 2 || ctx.state !== 'play') { a.throttle = 0; a.steer = 0; a.handbrake = true; return; }
    // nearest point on the route, then look ahead along it
    let ni = 0, nd = Infinity;
    for (let i = 0; i < route.length; i++) { const d = Math.hypot(route[i].x - s.x, route[i].z - s.z); if (d < nd) { nd = d; ni = i; } }
    const speed = Math.abs(s.speed);
    let look = 7 + speed * 0.55, j = ni;
    while (j < route.length - 1 && look > 0) { look -= Math.hypot(route[j + 1].x - route[j].x, route[j + 1].z - route[j].z); j++; }
    const t = route[j];
    const err = wrap(Math.atan2(-(t.x - s.x), -(t.z - s.z)) - s.heading);
    a.steer = Math.max(-1, Math.min(1, err * 1.9));
    const remaining = route.length - ni;
    const want = Math.max(4, Math.min(fast() ? 24 : 15, 16 - Math.abs(err) * 9, remaining * 1.1 + 3));
    a.throttle = Math.abs(err) > 2.2 ? -0.5 : speed < want ? 0.85 : speed > want + 3 ? -0.4 : 0;
    a.handbrake = false;
    // stuck against something: back up briefly, then hop back onto the line if that fails
    // (progress based: little ground covered over the last few seconds)
    const now = performance.now();
    if (!D.mark || now - D.mark.t > 2500) {
      const moved = D.mark ? Math.hypot(s.x - D.mark.x, s.z - D.mark.z) : 99;
      D.stuck = moved < 3 ? (D.stuck || 0) + 1 : 0;
      D.mark = { t: now, x: s.x, z: s.z };
    }
    if (D.stuck === 1) { a.throttle = -1; a.steer = -a.steer; }
    if (D.stuck >= 2) {
      D.stuck = 0;
      const k = Math.min(route.length - 1, ni + 4), k2 = Math.min(route.length - 1, k + 2);
      const p = route[k], q = route[k2];
      ctx.car.place(p.x, p.z, k2 > k ? Math.atan2(-(q.x - p.x), -(q.z - p.z)) : s.heading);
      ctx.cam.snap();
    }
  }
  ctx.on('update', () => { if (D.running && ctx.input.auto.active) drive(); });

  async function run() {
    const token = ++D.token;
    D.running = true; D.loops = 0; D.log = []; D.stuck = 0; D.mark = null;
    ctx.demo = D;
    ctx.hud.toast('Demo mode. Press 0 to stop', 3000);
    ctx.hud.closeChooser();
    const alive = () => token === D.token && D.running;
    try {
      for (let loop = 0; loop < (Number(ctx.params.get('demoloops')) || 2) && alive(); loop++) {
        mark('mission');
        await sayLine(LINES[Math.min(loop, LINES.length - 1)], token);
        if (!alive()) break;
        if (!ctx.missions.active) { mark('no-target'); break; }
        mark('drive');
        ctx.input.auto.active = true;
        const t0 = performance.now();
        while (alive() && !ctx.missions.state.arrived && performance.now() - t0 < 150000) await wait(100);
        ctx.input.auto.active = false;
        if (!alive()) break;
        if (!ctx.missions.state.arrived) { // never block the video: hop to the target
          const tg = ctx.missions.target, r = ctx.missions.route;
          const p = r && r.length ? r[r.length - 1] : { x: tg.mx, z: tg.mz };
          ctx.car.place(p.x, p.z);
          await wait(400);
        }
        mark('arrive');
        const target = ctx.missions.target || ctx.listingsSys.near;
        await wait(fast() ? 300 : 6500); // narration
        if (!alive() || !target) break;
        mark('tour');
        if ((target.matterportIds || []).length) {
          await ctx.tour.enter(target);
          const end = performance.now() + (fast() ? 1500 : 10000);
          let n = 0;
          while (alive() && performance.now() < end) { await wait(fast() ? 400 : 2400); if (ctx.tour.active && ++n <= 3) { ctx.tour.look(0.5); ctx.tour.forward(); } }
          if (ctx.tour.active) await ctx.tour.exit();
        }
        if (!alive()) break;
        mark('rate');
        ctx.missions.rate(target, true);
        await wait(fast() ? 200 : 1800);
        D.loops = loop + 1;
        mark('loop-done');
      }
      if (alive()) {
        mark('compare');
        ctx.emit('key', 'Tab', null);
        await wait(fast() ? 300 : 6000);
        ctx.emit('key', 'Tab', null);
        mark('done');
      }
    } finally {
      if (token === D.token) stop(true);
    }
  }

  function stop(quiet) {
    if (!D.running) return;
    D.running = false; D.token++;
    ctx.input.auto.active = false;
    window.__gpa.demo = { step: D.step, loops: D.loops, log: D.log, running: false };
    if (!quiet) ctx.hud.toast('Demo stopped');
  }

  ctx.on('key', (code) => {
    if (code !== 'Digit0') return;
    if (D.running) { stop(); if (ctx.tour.active) ctx.tour.exit(); } else if (ctx.state === 'play') run();
  });
  return { run, stop, get running() { return D.running; }, state: D };
}
