// Maya shows every home, whatever its scan has: a scan without room names gets a walk through
// unnamed "spaces", a space with no scan file of ours gets a route from the Showcase's own scan
// positions (Matterport view), and a space with no scan at all gets the listing photos.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';
const BROKEN = /NaN|undefined|\bnull\b|\[object/;

async function boot(page, extra = '') {
  await page.goto(`/?autostart=1&mute=1&tiles=0${extra}${MODE}${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
}

// walk the whole route with Enter; returns the stops she presented
async function walkRoute(page, shot) {
  await page.waitForFunction(() => window.__gpa.guide?.active === true, null, { timeout: 40_000 });
  const stops = await page.evaluate(() => window.__gpa.guide.stops);
  expect(stops.length).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__gpa.guide.line)).toMatch(/Welcome in/);
  await page.waitForFunction(() => window.__gpa.guide.phase === 'room', null, { timeout: 60_000 });
  const seen = [];
  for (let n = 0; n < 10; n++) {
    const g = await page.evaluate(() => window.__gpa.guide);
    if (g.phase === 'recap') break;
    expect(g.line.length).toBeGreaterThan(10);
    expect(g.line).not.toMatch(BROKEN);
    seen.push(g.room);
    if (n === 0 && shot) { await page.waitForTimeout(1500); await page.screenshot({ path: `${DIR}/${shot}` }); }
    await page.keyboard.press('Enter');
    await page.waitForFunction((r) => { const x = window.__gpa.guide; return x.phase === 'recap' || (x.phase === 'room' && x.room !== r); }, g.room, { timeout: 60_000 });
  }
  expect(new Set(seen).size).toBe(stops.length);
  const recap = await page.evaluate(() => window.__gpa.guide);
  expect(recap.phase).toBe('recap');
  expect(recap.line).not.toMatch(BROKEN);
  return { stops, seen };
}

test('a scan without room names still gets a guided walk', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, '&noshowcase=1');
  const found = await page.evaluate(async () => {
    const g = window.__gpa;
    for (const l of g.ctx.world.listings) {
      const id = (l.matterportIds || [])[0];
      if (!id || /^mock/.test(id)) continue;
      const m = await fetch(`${g.ctx.world.base}mp/${id}.json`).then((r) => (r.ok && !(r.headers.get('content-type') || '').includes('html') ? r.json() : null), () => null);
      if (m && m.panos?.length > 1 && !(m.rooms || []).length && !m.panos.some((p) => p.roomLabel)) { g.teleportNear(l.id, 10); await g.ctx.tour.enter(l, [id]); return true; }
    }
    return false;
  });
  test.skip(!found, 'every scan in this data set has room names');
  const { stops } = await walkRoute(page, '85-guide-spaces.png');
  console.log('route without room names', JSON.stringify(stops));
  expect(stops.every((s) => /^(Space \d+|The space)$/.test(s))).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a space with no scan at all gets a photo tour', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, '&noshowcase=1');
  const ok = await page.evaluate(async () => {
    const g = window.__gpa;
    const l = g.ctx.world.listings.find((x) => g.ctx.hud.photoSources(x).length > 1);
    if (!l) return false;
    g.teleportNear(l.id, 10);
    await g.ctx.tour.enter(l, ['no-such-scan']);
    return true;
  });
  test.skip(!ok, 'no listing with photos in this data set');
  expect(await page.evaluate(() => window.__gpa.tour.path)).toBe('G');
  const { stops } = await walkRoute(page, '86-guide-photos.png');
  console.log('photo route', JSON.stringify(stops));
  expect(stops[0]).toBe('Photo 1');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Matterport view: Maya leads from the scan positions the Showcase reports', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  const state = await page.evaluate(async () => {
    const g = window.__gpa;
    if (g.ctx.mock || !g.ctx.config.matterportSdkKey) return 'no showcase';
    // a space that has no scan file of ours: it can only open in the Showcase
    for (const l of g.ctx.world.listings) {
      for (const id of [...(l.matterportIds || []), ...(l.floorPlans || []).flatMap((f) => f.matterportIds || [])]) {
        const has = await fetch(`${g.ctx.world.base}mp/${id}.json`).then((r) => r.ok && !(r.headers.get('content-type') || '').includes('html'), () => false);
        if (!has) { g.teleportNear(l.id, 10); await g.ctx.tour.enter(l, [id]); return 'entered'; }
      }
    }
    return 'every space has a scan file';
  });
  test.skip(state !== 'entered', state);
  const path = await page.evaluate(() => window.__gpa.tour?.path);
  test.skip(path !== 'A' || !(await page.evaluate(() => window.__gpa.tour.connected)), `the Showcase did not connect (view ${path})`);
  const { stops } = await walkRoute(page, '87-guide-showcase.png');
  console.log('showcase route', JSON.stringify(stops));
});
