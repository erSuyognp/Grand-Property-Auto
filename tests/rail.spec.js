// Spline walk on real data, in both viewers: enter a home, hold W for 3 seconds, release,
// wait a second, screenshot; the camera must have moved along the route and settled on a scan
// position. Then the 45 second tour is started and checked to be moving.
// RAIL_TEST=1 runs both; the Showcase one needs internet, the SDK key and public/mp-bundle/.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.RAIL_TEST, 'set RAIL_TEST=1 to run (real data)');
const DIR = process.env.SHOT_DIR || 'shots';

async function enterHome(page, query) {
  await page.goto(`/?autostart=1&mute=1&tiles=0&notraffic&city=houston${query}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  const pick = Number(process.env.WALK_PICK || 0);
  const id = await page.evaluate(async (n) => {
    const g = window.__gpa, w = g.ctx.world, found = [];
    for (const l of w.listings) {
      if (!l.matterportIds.length) continue;
      const r = await fetch(`${w.base}mp/${l.matterportIds[0]}.json`);
      if (r.ok && !(r.headers.get('content-type') || '').includes('html')) { const j = await r.json(); if (j.featured) found.push(l.id); }
    }
    return found[n % Math.max(1, found.length)] || null;
  }, pick);
  expect(id, 'a prepared home').toBeTruthy();
  await page.evaluate((x) => window.__gpa.teleportNear(x, 10), id);
  await page.waitForFunction((x) => window.__gpa.ctx.listingsSys.near?.id === x, id, { timeout: 10_000 });
  await page.keyboard.press('KeyE');
}

const rail = (page) => page.evaluate(() => window.__gpa.ctx.tour.rail());

for (const which of ['showcase', 'own']) {
  test(`spline walk: ${which} viewer`, async ({ page }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(DIR, { recursive: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (/\[tour\]/.test(m.text())) console.log(m.text().slice(0, 200)); });
    await enterHome(page, which === 'showcase' ? '&tour=a' : '&noshowcase=1');
    if (which === 'showcase') {
      await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path === 'A' && window.__gpa.tour.rail === true, null, { timeout: 90_000 });
      await page.waitForTimeout(5000);
    } else {
      await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path === 'W', null, { timeout: 40_000 });
      await page.waitForTimeout(2500);
    }
    const a = await rail(page);
    console.log(`[${which}] start`, JSON.stringify(a));
    expect(a, 'rails are on').toBeTruthy();
    await page.screenshot({ path: `${DIR}/50-${which}-rail-start.png` });

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/51-${which}-rail-moving.png` });
    const mid = await rail(page);
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}/52-${which}-rail-settled.png` });
    let b = await rail(page);
    for (let i = 0; i < 20 && !b.settled; i++) { await page.waitForTimeout(150); b = await rail(page); }
    console.log(`[${which}] moving`, JSON.stringify(mid));
    console.log(`[${which}] after`, JSON.stringify(b), 'fps', await page.evaluate(() => window.__gpa.fps));
    expect(b.moved).toBeGreaterThan(1.5);          // 3 s at up to 1.2 m/s, with the run up
    expect(mid.v).toBeGreaterThan(0.5);
    expect(b.settled).toBe(true);                   // eased onto a scan position
    expect(b.node).toBeTruthy();
    if (which === 'showcase') expect(b.riding).toBe(false); // override released: Showcase shows the sweep itself

    // the tour: starts gliding by itself
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(4000);
    const t = await rail(page);
    console.log(`[${which}] tour`, JSON.stringify(t));
    expect(t.auto).toBe(true);
    expect(t.s).toBeGreaterThan(1);
    await page.screenshot({ path: `${DIR}/53-${which}-rail-tour.png` });
    await page.keyboard.press('KeyP');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 15_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
