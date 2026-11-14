// Buyer tools: an income profile, a pinned work place, three saved homes, the compare screen.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';

test('buyer tools: profile, my places, save 3 homes, compare, shortlist', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0&noprint=1${MODE}${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
  await page.evaluate(() => { localStorage.removeItem('gpa-buyer'); window.__gpa.ctx.saved.clear(); window.__gpa.buyer.setProfile(null); });

  // 1. "Can I afford it?" with the keyboard only
  await page.keyboard.press('KeyP');
  await page.waitForSelector('#bsheet.show #pf-income');
  await page.keyboard.type('165000');
  await page.keyboard.press('Tab'); await page.keyboard.type('600');
  await page.keyboard.press('Tab'); await page.keyboard.type('90000');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/50-afford.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gpa.buyer.budget > 0, null, { timeout: 5000 });
  const b = await page.evaluate(() => ({ budget: window.__gpa.buyer.budget, max: window.__gpa.buyer.maxPrice, tiers: Object.values(window.__gpa.buyer.tiers()).filter(Boolean) }));
  console.log('afford', JSON.stringify({ budget: b.budget, max: b.max, tiers: b.tiers.reduce((o, t) => ({ ...o, [t]: (o[t] || 0) + 1 }), {}) }));
  expect(b.tiers.length).toBeGreaterThan(3);

  // 2. pin a work place by name
  const pinned = await page.evaluate(() => window.__gpa.buyer.pin('Work', 'downtown'));
  expect(pinned).toBeTruthy();
  await page.keyboard.press('KeyO');
  await page.waitForSelector('#bsheet.show .plist');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/51-places.png` });
  await page.keyboard.press('Escape');

  // 3. the panel shows the budget line and the drive to work; the sun slider moves the sun
  const ids = await page.evaluate(() => window.__gpa.ctx.insights.rows().filter((r) => r.cost).slice(0, 3).map((r) => r.id));
  await page.evaluate((id) => { window.__gpa.teleportNear(id, 12); window.__gpa.select(id, true); }, ids[0]);
  await page.waitForFunction(() => window.__gpa.panel?.id, null, { timeout: 10_000 });
  await page.waitForTimeout(700);
  const txt = await page.locator('#ipanel').innerText();
  expect(txt).toMatch(/comfortable budget|A stretch|Out of range/);
  expect(txt).toMatch(/Work/);
  await page.locator('#ipanel [data-sun]').evaluate((n) => { n.value = 17.5; n.dispatchEvent(new Event('input', { bubbles: true })); n.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(600);
  expect(await page.locator('#ipanel .sunline').innerText()).toMatch(/5:30 PM/);
  await page.screenshot({ path: `${DIR}/52-sun.png` });
  await page.keyboard.press('Escape');

  // 4. save three homes and compare
  await page.evaluate((list) => { const g = window.__gpa; for (const id of list) g.ctx.saved.add(g.ctx.listingsSys.byId(id)); }, ids);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__gpa.compare?.open, null, { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/53-compare.png` });
  const c = await page.evaluate(() => window.__gpa.compare);
  expect(c.homes.length).toBe(3);
  expect(c.pick).toBeTruthy();
  const ctext = await page.locator('#compare').innerText();
  expect(ctext).toMatch(/Maya.s pick for you/i);
  expect(ctext).toMatch(/Drive to Work/i);
  expect(ctext).not.toMatch(/NaN|undefined|Infinity/);
  // 5. the shortlist report is built locally
  await page.locator('#compare .print').click();
  await page.waitForFunction(() => window.__gpa.report?.homes === 3, null, { timeout: 5000 });
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${DIR}/54-shortlist-report.png`, fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Tab');
  expect(errors, errors.join('\n')).toEqual([]);
});
