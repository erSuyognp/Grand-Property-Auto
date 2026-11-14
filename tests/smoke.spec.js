import { test, expect } from '@playwright/test';
import { inDataWindow } from '../server/dataWindow.js';
import { parseMission } from '../src/parser.js';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const game = (extra = '') => `/?autostart=1&mute=1&noshowcase=1${MODE}${extra}`;
const ready = (page) => page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });

test('server health responds', async ({ request }) => {
  const res = await request.get('http://localhost:8787/api/health');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).ok).toBe(true);
});

test('config never leaks server secrets', async ({ request }) => {
  const cfg = await (await request.get('http://localhost:8787/api/config')).json();
  expect(['real', 'mock']).toContain(cfg.mode);
  expect(Object.keys(cfg).sort()).toEqual(['httpsPort', 'lanIp', 'llm', 'matterportSdkKey', 'mode', 'sdkUrl', 'showcaseBase', 'tts']);
});

test('data window: Nov 13 4:30 PM to Nov 15 4:00 PM ET', () => {
  expect(inDataWindow(new Date('2026-11-13T16:29:59-05:00'))).toBe(false);
  expect(inDataWindow(new Date('2026-11-13T16:30:00-05:00'))).toBe(true);
  expect(inDataWindow(new Date('2026-11-15T15:59:59-05:00'))).toBe(true);
  expect(inDataWindow(new Date('2026-11-15T16:00:00-05:00'))).toBe(false);
});

test('keyword parser handles the demo lines offline', () => {
  const a = parseMission('three bedrooms under 900k with a pool');
  expect(a.filters).toMatchObject({ minBeds: 3, maxPrice: 900000, pool: true });
  expect(parseMission('something cheaper').relative).toBe('cheaper');
  const yard = parseMission('something with a bigger yard');
  expect(yard.relative).toBe('bigger');
  expect(yard.relativeOf).toBe('lot');
  const park = parseMission('closer to a park');
  expect(park.relative).toBe('closer');
  expect(park.near).toContain('park');
  expect(parseMission('find me more like this one').similar).toBe(true);
  const apt = parseMission('show me apartments under 2500 near a park');
  expect(apt.filters).toMatchObject({ kind: 'apartments', maxRent: 2500 });
  expect(apt.near).toContain('park');
  expect(parseMission('under 1.2 million with good schools').filters.maxPrice).toBe(1200000);
  expect(parseMission('take me inside').action).toBe('tour');
  expect(parseMission('see it empty').action).toBe('empty');
});

test('mission endpoint answers with filters (keyword parser or Claude)', async ({ request }) => {
  const res = await request.post('http://localhost:8787/api/mission', { data: { transcript: 'three bedrooms under 900k with a pool' } });
  const j = await res.json();
  expect(j.filters.minBeds).toBe(3);
  expect(j.filters.maxPrice).toBe(900000);
  expect(j.filters.pool).toBe(true);
});

test('?mode=mock forces mock mode', async ({ page }) => {
  await page.goto('/?autostart=1&mute=1&mode=mock');
  await ready(page);
  expect(await page.evaluate(() => window.__gpa.mode)).toBe('mock');
});

test('driving next to a listing shows its card', async ({ page }) => {
  await page.goto(game());
  await ready(page);
  await page.evaluate(() => window.__gpa.teleportNear(window.__gpa.ctx.world.listings[0].id, 60));
  await page.waitForTimeout(300);
  // drive toward the listing until the card appears
  const shown = await page.evaluate(async () => {
    const g = window.__gpa, l = g.ctx.world.listings[0];
    for (let i = 0; i < 40; i++) {
      if (g.ctx.listingsSys.near) return true;
      g.teleportNear(l.id, 60 - i * 2);
      await new Promise((r) => setTimeout(r, 80));
    }
    return !!g.ctx.listingsSys.near;
  });
  expect(shown).toBe(true);
  await expect(page.locator('#card.show')).toBeVisible();
  await expect(page.locator('#card .price')).not.toBeEmpty();
});

test('a spoken mission highlights a target and draws the GPS ribbon', async ({ page }) => {
  await page.goto(game());
  await ready(page);
  await page.evaluate(() => window.__gpa.say('three bedrooms under 900k with a pool'));
  await page.waitForFunction(() => window.__gpa.mission().ribbon === true, null, { timeout: 15_000 });
  const m = await page.evaluate(() => window.__gpa.mission());
  expect(m.target).toBeTruthy();
  expect(m.top.length).toBeGreaterThan(0);
  expect(m.filters.minBeds).toBe(3);
  await expect(page.locator('#arrow.show')).toBeVisible();
  // a relative follow up changes the target
  await page.evaluate(() => { const g = window.__gpa; g.ctx.missions.state.last = g.ctx.world.listings.find((l) => l.id === g.mission().target); return g.say('something cheaper'); });
  await page.waitForTimeout(500);
  const m2 = await page.evaluate(() => window.__gpa.mission());
  expect(m2.target).not.toBe(m.target);
});

test('phone controller: steer and gas from a second page move the car', async ({ browser }) => {
  const context = await browser.newContext();
  const gamePage = await context.newPage();
  await gamePage.goto(game());
  await ready(gamePage);
  const room = await gamePage.evaluate(() => window.__gpa.room);
  const start = await gamePage.evaluate(() => ({ ...window.__gpa.car }));
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 780 });
  await phone.goto(`http://localhost:8787/phone?room=${room}`);
  await gamePage.waitForFunction(() => window.__gpa.ctx.controller.phones > 0, null, { timeout: 10_000 });
  await phone.evaluate(() => window.__phone.set({ steer: 0.3, gas: 1 }));
  await gamePage.waitForTimeout(2500);
  await phone.evaluate(() => window.__phone.set({ steer: null, gas: 0 }));
  const end = await gamePage.evaluate(() => ({ ...window.__gpa.car }));
  expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(4);
  await phone.screenshot({ path: `${process.env.SHOT_DIR || 'shots'}/11-phone.png` });
  await context.close();
});

test('demo mode runs a full loop', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(game('&demofast=1&demoloops=2'));
  await ready(page);
  await page.keyboard.press('Digit0');
  await page.waitForFunction(() => window.__gpa.demo && window.__gpa.demo.step === 'done', null, { timeout: 220_000 });
  const d = await page.evaluate(() => window.__gpa.demo);
  expect(d.loops).toBe(2);
  for (const step of ['mission', 'drive', 'arrive', 'tour', 'rate', 'compare']) expect(d.log).toContain(step);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('offline: no server and no internet, the game still drives, shows cards and runs missions', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // cut the Node server and everything that is not this machine
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/') || !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto(game());
  await ready(page);
  await page.evaluate(() => window.__gpa.say('three bedrooms under 900k with a pool'));
  await page.waitForFunction(() => window.__gpa.mission().ribbon === true, null, { timeout: 15_000 });
  const target = await page.evaluate(() => window.__gpa.teleportNear(window.__gpa.mission().target, 10));
  await page.waitForFunction((t) => window.__gpa.ctx.listingsSys.near?.id === t, target, { timeout: 10_000 });
  await expect(page.locator('#card.show')).toBeVisible();
  await page.waitForFunction(() => !!window.__gpa.lastSpoken && window.__gpa.ctx.missions.state.arrived, null, { timeout: 10_000 });
  // walk in with no network: walk mode, built in viewer or the photo gallery, never a dead end
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__gpa.tour && ['W', 'B', 'G'].includes(window.__gpa.tour.path), null, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
