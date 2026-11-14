// Client missions: accept mission 1, submit the best home through the debug API, expect 3 stars.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';

test('missions: accept mission 1, submit the best home, 3 stars', async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${MODE}${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
  await page.evaluate(() => window.__gpa.clients.reset());
  const list = await page.evaluate(() => window.__gpa.clients.list());
  console.log('missions', JSON.stringify(list.map((m) => `${m.id} ${m.title}`)));
  expect(list.length).toBeGreaterThanOrEqual(6);
  // the inbox
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/40-inbox.png` });
  await page.locator('#inbox .mlist button').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/41-client.png` });
  await page.locator('#inbox .accept').click();
  await page.waitForFunction(() => window.__gpa.clients.active === '1', null, { timeout: 5000 });
  // select the best home: the tracker checks every need
  const best = await page.evaluate(() => window.__gpa.clients.best('1'));
  await page.evaluate((id) => { window.__gpa.teleportNear(id, 12); window.__gpa.select(id, true); }, best);
  await page.waitForFunction(() => window.__gpa.panel?.id, null, { timeout: 10_000 });
  await page.waitForTimeout(900);
  await expect(page.locator('#tracker li.ok')).toHaveCount(3);
  await page.screenshot({ path: `${DIR}/42-mission-check.png` });
  await page.locator('#ipanel [data-act="submit"]').click();
  await page.waitForFunction(() => window.__gpa.clients.last?.id === '1', null, { timeout: 5000 });
  const out = await page.evaluate(() => window.__gpa.clients.last);
  console.log('result', JSON.stringify(out));
  expect(out.stars).toBe(3);
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${DIR}/43-mission-result.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 5000 });
  // every other home mission is solvable too: its best home earns 3 stars
  const all = await page.evaluate(async () => {
    const c = window.__gpa.clients, res = [];
    for (const m of c.list()) {
      if (m.game) continue;
      c.accept(m.id);
      const r = window.__gpa.clients.submit(m.best);
      res.push([m.id, r && r.stars]);
      document.querySelector('#cresult [data-a="ok"]').click();
    }
    return res;
  });
  console.log('all', JSON.stringify(all));
  for (const [, stars] of all) expect(stars).toBe(3);
  // Price Detective
  if (list.some((m) => m.id === '10')) {
    await page.evaluate(() => window.__gpa.clients.accept('10'));
    await page.waitForSelector('#cresult .gslider', { timeout: 10_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/44-price-detective.png` });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__gpa.clients.last?.id === '10', null, { timeout: 5000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${DIR}/45-price-detective-result.png` });
    await page.keyboard.press('Enter');
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
