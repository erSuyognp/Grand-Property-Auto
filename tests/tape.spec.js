// Tape measure inside a home: R, two points on the scan's mesh, a distance in feet.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';

test('tape measure: two points inside a home give a distance', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(DIR, { recursive: true });
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${MODE}${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  const ok = await page.evaluate(async () => {
    const g = window.__gpa;
    const l = g.ctx.world.listings.find((x) => x.kind !== 'apartments' && x.matterportIds.length) || g.ctx.world.listings.find((x) => x.matterportIds.length);
    if (!l) return false;
    g.teleportNear(l.id, 10);
    await g.ctx.tour.enter(l);
    return true;
  });
  test.skip(!ok, 'no home with a 3D scan in this data set');
  await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path, null, { timeout: 30_000 });
  const path = await page.evaluate(() => window.__gpa.tour.path);
  test.skip(path !== 'W', `tape measure needs the walking view (this home opened in view ${path})`);
  await page.waitForFunction(() => window.__gpa.ctx.tour.walk.ready, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__gpa.tape?.on === true, null, { timeout: 5000 });
  // two points on the floor in front of the camera
  await page.evaluate(() => { const t = window.__gpa.ctx.tour; t.tapePick(-0.35, -0.55); t.tapePick(0.35, -0.55); });
  await page.waitForFunction(() => window.__gpa.tape?.feet > 0, null, { timeout: 5000 });
  const feet = await page.evaluate(() => window.__gpa.tape.feet);
  console.log(`tape: ${feet.toFixed(2)} ft`);
  expect(feet).toBeGreaterThan(0.3);
  expect(feet).toBeLessThan(80);
  await page.waitForTimeout(500);
  await expect(page.locator('.tape-label.show')).toBeVisible();
  await page.screenshot({ path: `${DIR}/55-tape-measure.png` });
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Escape');
});
