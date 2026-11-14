// Free walking inside a home on real data: enter, walk with W, turn, strafe, check that the
// player moved and stayed on a floor, then Esc back to the car. Needs real city data with
// interior meshes, so it only runs with WALK_TEST=1.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.WALK_TEST, 'set WALK_TEST=1 to run (real data)');
const CITY = process.env.SHOT_CITY || 'houston';
const DIR = process.env.SHOT_DIR || 'shots';

test('walk freely inside a home', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/\[tour\]/.test(m.text())) console.log(m.text().slice(0, 200)); });
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0&city=${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  const pick = Number(process.env.WALK_PICK || 0);
  const id = await page.evaluate(async (n) => {
    const g = window.__gpa, w = g.ctx.world;
    const found = [];
    for (const l of w.listings) {
      if (!l.matterportIds.length) continue;
      const r = await fetch(`${w.base}mp/${l.matterportIds[0]}.json`);
      if (r.ok && !(r.headers.get('content-type') || '').includes('html')) { const j = await r.json(); if (j.mesh) found.push(l.id); }
    }
    return found[n % Math.max(1, found.length)] || null;
  }, pick);
  expect(id, 'a listing with an interior mesh').toBeTruthy();
  await page.evaluate((x) => window.__gpa.teleportNear(x, 10), id);
  await page.waitForFunction((x) => window.__gpa.ctx.listingsSys.near?.id === x, id, { timeout: 10_000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path, null, { timeout: 40_000 });
  const tour = await page.evaluate(() => window.__gpa.tour);
  console.log('path', JSON.stringify(tour));
  expect(tour.path).toBe('W');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/30-walk-start.png` });
  const info = () => page.evaluate(() => window.__gpa.ctx.tour.walk.info());
  const a = await info();
  let moved = 0, last = a;
  // walk, and turn whenever a wall stops us
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1300);
    await page.keyboard.up('KeyW');
    const now = await info();
    const step = Math.hypot(now.x - last.x, now.z - last.z);
    moved += step;
    last = now;
    if (i < 3) await page.screenshot({ path: `${DIR}/3${i + 1}-walk.png` });
    if (step < 0.8) { await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(700); await page.keyboard.up('ArrowLeft'); }
  }
  console.log(`walked ${moved.toFixed(1)} m, height change ${(last.y - a.y).toFixed(2)} m, fps ${await page.evaluate(() => window.__gpa.fps)}`);
  expect(moved).toBeGreaterThan(2);
  expect(Math.abs(last.y - a.y)).toBeLessThan(4);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
