// Walk mode on real data: enter a home, walk forward for 3 seconds, screenshot, and confirm
// the camera moved and stayed inside the walls and on a floor. Then wander, turning at walls,
// and Esc back to the car. Needs real city data with interior meshes: WALK_TEST=1.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.WALK_TEST, 'set WALK_TEST=1 to run (real data)');
const CITY = process.env.SHOT_CITY || 'houston';
const DIR = process.env.SHOT_DIR || 'shots';

test('walk mode: walk forward 3 s, moved, stayed inside', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/\[tour\]/.test(m.text())) console.log(m.text().slice(0, 200)); });
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0&city=${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  const pick = Number(process.env.WALK_PICK || 0);
  // the homes prepared for the demo (sharper sky boxes) first, then any home with a mesh
  const id = await page.evaluate(async (n) => {
    const g = window.__gpa, w = g.ctx.world;
    const featured = [], other = [];
    for (const l of w.listings) {
      if (!l.matterportIds.length) continue;
      const r = await fetch(`${w.base}mp/${l.matterportIds[0]}.json`);
      if (r.ok && !(r.headers.get('content-type') || '').includes('html')) { const j = await r.json(); if (j.mesh) (j.featured ? featured : other).push(l.id); }
    }
    const all = featured.concat(other);
    return all[n % Math.max(1, all.length)] || null;
  }, pick);
  expect(id, 'a listing with an interior mesh').toBeTruthy();
  await page.evaluate((x) => window.__gpa.teleportNear(x, 10), id);
  await page.waitForFunction((x) => window.__gpa.ctx.listingsSys.near?.id === x, id, { timeout: 10_000 });
  await page.keyboard.press('KeyE'); // select the home (the reveal)
  await page.waitForFunction(() => window.__gpa.reveal?.id, null, { timeout: 10_000 });
  await page.keyboard.press('KeyE'); // walk inside
  await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path, null, { timeout: 40_000 });
  const tour = await page.evaluate(() => window.__gpa.tour);
  console.log('path', JSON.stringify(tour));
  expect(tour.path).toBe('W');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/30-walk-start.png` });
  const info = () => page.evaluate(() => window.__gpa.ctx.tour.walk.info());
  const a = await info();
  console.log('start', JSON.stringify(a));

  // the test in the brief: forward for three seconds
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  const mid = await info();
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/31-walk-3s.png` });
  const b = await info();
  const first = Math.hypot(b.x - a.x, b.z - a.z);
  console.log(`after 3 s: moved ${first.toFixed(2)} m, speed while walking ${mid.speed.toFixed(2)} m/s, inside ${b.inside}, on a floor ${b.onFloor}, fps ${await page.evaluate(() => window.__gpa.fps)}`);
  expect(first).toBeGreaterThan(0.5);
  expect(b.inside).toBe(true);
  expect(b.onFloor).toBe(true);

  // wander: turn whenever a wall stops us, and never leave the house
  let moved = first, last = b;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1300);
    await page.keyboard.up('KeyW');
    const now = await info();
    const step = Math.hypot(now.x - last.x, now.z - last.z);
    moved += step;
    last = now;
    expect(now.inside).toBe(true);
    if (i === 1 || i === 4) await page.screenshot({ path: `${DIR}/3${i === 1 ? 2 : 3}-walk.png` });
    if (step < 0.9) { await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(650); await page.keyboard.up('ArrowLeft'); }
  }
  console.log(`walked ${moved.toFixed(1)} m in all, height change ${(last.y - a.y).toFixed(2)} m, end ${JSON.stringify(last)}`);
  expect(moved).toBeGreaterThan(2);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
