// Walk inside on real data: Path A (the Matterport Showcase through the Embed SDK), then the
// T key to our own viewer, moving between scan positions, "See it empty", and Esc back to
// the car. Needs real city data, the SDK key and internet, so it only runs with TOUR_TEST=1.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.TOUR_TEST, 'set TOUR_TEST=1 to run (real data, hits Matterport)');
const CITY = process.env.SHOT_CITY || 'houston';
const DIR = process.env.SHOT_DIR || 'shots';

test('walk inside: Showcase, own viewer, empty view, exit', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(DIR, { recursive: true });
  page.on('console', (m) => { if (/\[tour\]/.test(m.text())) console.log(m.text().slice(0, 200)); });
  await page.goto(`/?autostart=1&mute=1&tiles=0&city=${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  // a home whose panoramas are on disk, so both paths can be shown
  const id = await page.evaluate(async () => {
    const g = window.__gpa, w = g.ctx.world;
    for (const l of w.listings) {
      if (!l.matterportIds.length) continue;
      const r = await fetch(`${w.base}mp/${l.matterportIds[0]}.json`);
      if (r.ok && !(r.headers.get('content-type') || '').includes('html')) { const j = await r.json(); if (j.panos.length >= 3) return l.id; }
    }
    return null;
  });
  expect(id, 'a listing with panoramas on disk').toBeTruthy();
  await page.evaluate((x) => window.__gpa.teleportNear(x, 10), id);
  await page.waitForFunction((x) => window.__gpa.ctx.listingsSys.near?.id === x, id, { timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/20-curb.png` });
  await page.keyboard.press('KeyE'); // select the home (the reveal)
  await page.waitForFunction(() => window.__gpa.reveal?.id, null, { timeout: 10_000 });
  await page.keyboard.press('KeyE'); // walk inside
  await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path, null, { timeout: 40_000 });
  const first = await page.evaluate(() => window.__gpa.tour);
  console.log('first path', JSON.stringify(first));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${DIR}/21-tour-showcase.png` });
  if (first.path === 'A') {
    expect(first.connected).toBe(true);
    await page.evaluate(() => window.__gpa.ctx.tour.switchPath());
    await page.waitForFunction(() => window.__gpa.tour?.path === 'B', null, { timeout: 20_000 });
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/22-tour-own.png` });
  // move between at least three scan positions
  const seen = new Set([await page.evaluate(() => window.__gpa.ctx.tour.info().pano)]);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.__gpa.ctx.tour.stepSweep(1));
    await page.waitForTimeout(1200);
    seen.add(await page.evaluate(() => window.__gpa.ctx.tour.info().pano));
  }
  console.log('scan positions visited', seen.size);
  expect(seen.size).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `${DIR}/23-tour-moved.png` });
  const info = await page.evaluate(() => window.__gpa.ctx.tour.info());
  if (info.hasEmpty) {
    await page.evaluate(() => window.__gpa.ctx.tour.toggleEmpty());
    await page.waitForTimeout(1800);
    expect(await page.evaluate(() => window.__gpa.ctx.tour.info().empty)).toBe(true);
    await page.screenshot({ path: `${DIR}/24-tour-empty.png` });
  } else console.log('no furniture free panoramas for this home');
  await page.evaluate(() => window.__gpa.ctx.tour.exit());
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/25-back.png` });
});
