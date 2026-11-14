// One-off calibration for the built in panorama viewer: for a few scan positions, find the
// yaw in our viewer that shows the same picture as the Matterport Showcase at a known camera
// pose. The numbers printed here fix the frame conversion constant in src/tour.js.
// Needs real data and internet: runs only with CALIBRATE=1.
import { test } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.CALIBRATE, 'set CALIBRATE=1 to run');

test('calibrate skybox orientation against the Showcase', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto(`/?autostart=1&mute=1&city=${process.env.SHOT_CITY || 'houston'}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  const id = await page.evaluate(async () => {
    const g = window.__gpa, w = g.ctx.world;
    for (const l of w.listings) {
      if (!l.matterportIds.length) continue;
      const r = await fetch(`${w.base}mp/${l.matterportIds[0]}.json`);
      if (r.ok && !(r.headers.get('content-type') || '').includes('html')) { const j = await r.json(); if (j.panos.length >= 4) return l.id; }
    }
    return null;
  });
  await page.evaluate((x) => { const g = window.__gpa; g.ctx.tour.enter(g.ctx.world.listings.find((l) => l.id === x)); }, id);
  await page.waitForFunction(() => window.__gpa.tour?.path === 'A' && window.__gpa.tour.connected, null, { timeout: 60_000 });
  await page.addStyleTag({ content: '#tour .top, #tour .bar, #tour .fmap, #tour .hint, #hud { display: none !important; }' });
  await page.waitForTimeout(5000);
  const sweeps = await page.evaluate(async () => {
    const T = window.__gpa.ctx.tour._state;
    const data = await T.sdk.Model.getData();
    return data.sweeps.map((s) => ({ id: s.uuid || s.sid, sid: s.sid, position: s.position, rotation: s.rotation }));
  });
  const panos = await page.evaluate(() => window.__gpa.ctx.tour._state.meta.panos.map((p) => ({ id: p.id, p: p.p, q: p.q })));
  const common = panos.filter((p) => sweeps.some((s) => s.id === p.id || s.sid === p.id)).slice(0, 4);
  console.log('sweeps', sweeps.length, 'local panos', panos.length, 'common', common.length, 'sample sweep', JSON.stringify(sweeps[0]));
  const shots = [];
  for (const p of common) {
    const pose = await page.evaluate(async (pid) => {
      const T = window.__gpa.ctx.tour._state, sdk = T.sdk;
      await sdk.Sweep.moveTo(pid, { transition: sdk.Sweep.Transition.INSTANT, transitionTime: 0, rotation: { x: 0, y: 0 } });
      await new Promise((r) => setTimeout(r, 3500));
      return new Promise((res) => { const sub = sdk.Camera.pose.subscribe((pose) => { res({ position: pose.position, rotation: pose.rotation, sweep: pose.sweep }); sub.cancel(); }); });
    }, p.id);
    const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
    shots.push({ pano: p, pose, img: buf.toString('base64') });
    fs.writeFileSync(`data/samples/calib_showcase_${shots.length}.jpg`, buf);
    console.log('pose', p.id, JSON.stringify(pose));
  }
  // our viewer, same panos, sweep the yaw
  await page.evaluate(() => window.__gpa.ctx.tour.switchPath());
  await page.waitForFunction(() => window.__gpa.tour?.path === 'B', null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__score = async (a, b) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const W = 96, H = 54, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      const gray = (img) => { g.drawImage(img, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data; const o = new Float32Array(W * H); let m = 0; for (let i = 0; i < W * H; i++) { o[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.6 + d[i * 4 + 2] * 0.1; m += o[i]; } m /= W * H; let v = 0; for (let i = 0; i < W * H; i++) { o[i] -= m; v += o[i] * o[i]; } return { o, v }; };
      const A = gray(ia), B = gray(ib);
      let dot = 0; for (let i = 0; i < W * H; i++) dot += A.o[i] * B.o[i];
      return dot / Math.sqrt(A.v * B.v + 1e-9);
    };
  });
  const out = [];
  for (const s of shots) {
    await page.evaluate(async (pid) => {
      const T = window.__gpa.ctx.tour._state;
      const p = T.meta.panos.find((x) => x.id === pid);
      T.pano = null; T.token++;
      await window.__gpa.ctx.tour._show(p);
      T.pitch = 0;
    }, s.pano.id);
    await page.waitForTimeout(800);
    let best = { score: -2 }, second = { score: -2 };
    for (let deg = 0; deg < 360; deg += 6) {
      await page.evaluate((d) => { window.__gpa.ctx.tour._state.yaw = (d * Math.PI) / 180; }, deg);
      await page.waitForTimeout(60);
      const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
      const score = await page.evaluate(([a, b]) => window.__score(a, b), [s.img, buf.toString('base64')]);
      if (score > best.score) { second = best; best = { deg, score }; if (deg % 1 === 0) fs.writeFileSync(`data/samples/calib_own_${out.length + 1}.jpg`, buf); } else if (score > second.score) second = { deg, score };
    }
    out.push({ id: s.pano.id, p: s.pano.p, q: s.pano.q, sdkPose: s.pose, bestYawDeg: best.deg, score: +best.score.toFixed(3), second });
    console.log('best', JSON.stringify(out[out.length - 1]));
  }
  fs.writeFileSync('data/samples/calibration.json', JSON.stringify({ sweeps, out }, null, 1));
});
