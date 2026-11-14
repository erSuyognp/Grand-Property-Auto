// Demo mode (press 0): an autopilot run for the backup video and the judges. It opens on the
// problem (scrolling flat listings), then: a spoken search, the drive along the gold line, the
// property reveal, Maya's pitch and the monthly cost against renting, a better fit she
// suggests and drives to, a walk inside with the tape measure, a client mission finished with
// three stars, and the compare screen. Works with the server stopped and the network off
// (Maya falls back to her scripted lines).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function initDemo(ctx) {
  const D = { running: false, token: 0, step: '', loops: 0, log: [] };
  const fast = () => ctx.params.has('demofast');
  const T = (ms, fastMs = 60) => wait(fast() ? fastMs : ms);

  function mark(step) { D.step = step; D.log.push(step); window.__gpa.demo = { step, loops: D.loops, log: D.log, running: D.running }; ctx.emit('demo-step', step); }

  async function sayLine(text, token, viaMaya = true) {
    // show it the way live speech shows up: words arriving in the caption bar
    const words = text.split(' ');
    for (let i = 1; i <= words.length; i++) {
      if (token !== D.token) return;
      ctx.hud.live(words.slice(0, i).join(' '));
      await wait(fast() ? 15 : 120);
    }
    await T(450, 40);
    ctx.hud.live(null);
    if (viaMaya && ctx.maya) await ctx.maya.hear(text); else await ctx.missions.handle(text);
  }
  // wait until Maya has finished talking (or give up)
  async function quiet(token, max = 22000) {
    const t0 = performance.now();
    await T(700, 120);
    while (token === D.token && performance.now() - t0 < (fast() ? 9000 : max)) {
      const s = ctx.maya?.state;
      if (!s || (s.state === 'idle' && !ctx.maya.speaking)) break;
      await wait(120);
    }
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

  // drive the gold line to the mission target; hop there if the car cannot make it in time
  async function driveToTarget(alive) {
    ctx.input.auto.active = true;
    D.stuck = 0; D.mark = null;
    const t0 = performance.now();
    while (alive() && !ctx.missions.state.arrived && performance.now() - t0 < (fast() ? 40000 : 150000)) await wait(100);
    ctx.input.auto.active = false;
    if (!alive()) return null;
    const tg = ctx.missions.target || ctx.listingsSys.near;
    if (!ctx.missions.state.arrived && tg) { // never block the video: hop to the target
      const r = ctx.missions.route;
      const p = r && r.length ? r[r.length - 1] : { x: tg.mx, z: tg.mz };
      ctx.car.place(p.x, p.z);
      await wait(400);
    }
    return tg;
  }

  // the problem: house hunting as a wall of flat listings
  async function flatListings(alive) {
    const el = document.createElement('div');
    el.id = 'flat';
    const L = ctx.world.listings;
    const rows = Array.from({ length: 26 }, (_, i) => { const l = L[i % L.length]; return `<div class="frow"><i></i><div><b>${l.price ? '$' + Math.round(l.price).toLocaleString('en-US') : l.rent ? '$' + Math.round(l.rent).toLocaleString('en-US') + '/mo' : 'Call for price'}</b><small>${l.beds ?? '-'} bd · ${l.baths ?? '-'} ba · ${l.sqft ? Number(l.sqft).toLocaleString('en-US') : '-'} sqft</small><small>Charming home in a great location. Must see!</small></div><small>Listed ${3 + ((i * 7) % 40)} days ago</small></div>`; }).join('');
    el.innerHTML = `<div class="fhead">Homes for sale <span>${L.length} results · sorted by newest</span></div><div class="frows">${rows}</div><div class="fover"><p>Listings tell you the price.<small>They don't tell you what it's like to live there.</small></p></div>`;
    document.body.append(el);
    el.classList.add('show');
    await T(5200, 250);
    el.classList.add('out');
    await T(900, 60);
    el.remove();
    return alive();
  }

  async function run() {
    const token = ++D.token;
    D.running = true; D.loops = 0; D.log = []; D.stuck = 0; D.mark = null;
    ctx.demo = D;
    ctx.hud.toast('Demo mode. Press 0 to stop', 3000);
    ctx.hud.closeChooser();
    ctx.reveal?.close();
    const alive = () => token === D.token && D.running;
    const rowsOk = () => ctx.insights?.ready;
    try {
      mark('problem');
      if (!(await flatListings(alive))) return;

      // 1. a spoken search lights up matches and draws the route
      mark('mission');
      await sayLine('find me a three bedroom under 900k near a park', token);
      if (!alive()) return;
      if (!ctx.missions.active) { const l = ctx.world.listings.find((x) => x.kind === 'sale') || ctx.world.listings[0]; ctx.missions.goTo(l, true); }
      mark('drive');
      const first = await driveToTarget(alive);
      if (!alive() || !first) return;
      mark('arrive');
      await T(1600, 150);

      // 2. the reveal, then Maya: her pitch, then the monthly cost against renting
      mark('reveal');
      await ctx.reveal.select(first, { instant: fast() });
      const r0 = performance.now();
      while (alive() && ctx.reveal.stage < 3 && performance.now() - r0 < 9000) await wait(100);
      await T(1500, 100);
      if (!alive()) return;
      if (rowsOk()) {
        mark('maya');
        ctx.maya.open(true);
        await quiet(token);
        if (!alive()) return;
        await sayLine('what would I pay per month, and how does that compare to renting?', token);
        await quiet(token);
        ctx.panel.flash('cost');
        await T(2200, 100);
        if (!alive()) return;

        // 3. a better fit: she suggests one and drives there
        mark('better');
        await sayLine('show me a better fit for the money', token);
        await quiet(token);
        await T(1200, 100);
      }
      if (!alive()) return;
      const next = ctx.maya?.state.offered || ctx.world.listings.find((x) => x !== first && x.kind === 'sale' && (x.matterportIds || []).length) || ctx.world.listings.find((x) => x !== first && (x.matterportIds || []).length) || first;
      ctx.saved.add(first);
      if (ctx.maya?.state.offered) { await sayLine('yes, take me there', token); await T(800, 80); }
      if (!ctx.missions.active || ctx.missions.target !== next) { ctx.reveal.close(); ctx.missions.goTo(next, true); }
      D.loops = 1;
      mark('loop-done');
      mark('drive');
      const second = (await driveToTarget(alive)) || next;
      if (!alive()) return;
      mark('arrive');
      await T(1500, 120);

      // 4. walk inside, glide the route, measure a room
      mark('tour');
      const tourable = (second.matterportIds || []).length ? second : first;
      if ((tourable.matterportIds || []).length) {
        await ctx.tour.enter(tourable);
        const end = performance.now() + (fast() ? 1500 : 9000);
        let n = 0;
        const gliding = ctx.tour.active && ctx.tour.autoTour(fast() ? 6 : 45);
        while (alive() && performance.now() < end) { await wait(fast() ? 400 : 2400); if (!gliding && ctx.tour.active && ++n <= 3) { ctx.tour.look(0.5); ctx.tour.forward(); } }
        if (alive() && ctx.tour.active && ctx.tour.path === 'W' && ctx.tour.walk.ready) {
          mark('measure');
          if (gliding) ctx.tour.autoTour();
          ctx.tour.toggleTape(true);
          await T(700, 60);
          ctx.tour.tapePick(-0.4, -0.5);
          await T(700, 60);
          ctx.tour.tapePick(0.4, -0.5);
          await T(3200, 150);
          ctx.tour.toggleTape(false);
        }
        if (ctx.tour.active) await ctx.tour.exit();
      }
      if (!alive()) return;
      mark('rate');
      ctx.hud.closeChooser();
      ctx.missions.rate(tourable, true);
      await T(1500, 120);

      // 5. a client mission, finished with three stars
      if (rowsOk() && ctx.clients.missions.length) {
        mark('client');
        const m = ctx.clients.missions.find((x) => !x.game && x.bestId) || null;
        if (m) {
          ctx.clients.accept(m.id);
          await T(3200, 120);
          const best = ctx.listingsSys.byId(m.bestId);
          await ctx.reveal.select(best, { instant: true });
          await T(2600, 150);
          if (!alive()) return;
          ctx.clients.submit(best);
          await T(4200, 200);
          document.querySelector('#cresult [data-a="ok"]')?.click();
          ctx.reveal.close();
          await T(600, 60);
        }
      }
      if (!alive()) return;
      D.loops = 2;
      mark('loop-done');

      // 6. the saved homes side by side, with Maya's pick
      mark('compare');
      if (ctx.state === 'play') ctx.emit('key', 'Tab', null);
      await T(6500, 300);
      if (ctx.compare.open) ctx.emit('key', 'Tab', null);
      mark('done');
    } finally {
      if (token === D.token) stop(true);
    }
  }

  function stop(quiet2) {
    if (!D.running) return;
    D.running = false; D.token++;
    ctx.input.auto.active = false;
    document.getElementById('flat')?.remove();
    window.__gpa.demo = { step: D.step, loops: D.loops, log: D.log, running: false };
    if (!quiet2) { ctx.hud.toast('Demo stopped'); ctx.maya?.interrupt(); }
  }

  ctx.on('key', (code) => {
    if (code !== 'Digit0') return;
    if (D.running) { stop(); if (ctx.tour.active) ctx.tour.exit(); } else if (ctx.state === 'play') run();
  });
  return { run, stop, get running() { return D.running; }, state: D };
}
