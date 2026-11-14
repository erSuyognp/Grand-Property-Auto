// Drone view on real data: park at a home that has an exterior splat, press Q, watch the
// orbit, Esc back to the car. Needs real city data with splats, so it runs with DRONE_TEST=1.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.DRONE_TEST, 'set DRONE_TEST=1 to run (real data)');
const DIR = process.env.SHOT_DIR || 'shots';

test('drone view orbits the splat', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/\[drone\]/.test(m.text())) console.log(m.text().slice(0, 200)); });
  await page.goto('/?autostart=1&mute=1&noshowcase=1&city=houston&tiles=0');
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  const pick = Number(process.env.DRONE_PICK || 0);
  const id = await page.evaluate((n) => { const l = window.__gpa.ctx.world.listings.filter((x) => x.splat); return l.length ? l[n % l.length].id : null; }, pick);
  expect(id, 'a listing with a splat').toBeTruthy();
  await page.evaluate((x) => window.__gpa.teleportNear(x, 10), id);
  await page.waitForFunction((x) => window.__gpa.ctx.listingsSys.near?.id === x, id, { timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/40-drone-prompt.png` });
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => window.__gpa.drone?.active === true, null, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${DIR}/41-drone.png` });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${DIR}/42-drone.png` });
  console.log('drone fps', await page.evaluate(() => window.__gpa.fps), JSON.stringify(await page.evaluate(() => window.__gpa.drone)));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
