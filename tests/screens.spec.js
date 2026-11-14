// Screenshots of the remaining screens (settings, tutorial, the demo's opening) and a
// keyboard only pass through the main features.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';
const ready = (page) => page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });

test('screens: settings, tutorial, demo opening', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0&tutorial=1${MODE}${CITY}`);
  await ready(page);
  await page.waitForFunction(() => window.__gpa.tutorial?.step >= 2, null, { timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/60-tutorial.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.tutorial?.done === true, null, { timeout: 5000 });
  await page.keyboard.press('KeyU');
  await page.waitForSelector('#settings.show');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/61-settings.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 5000 });
  await page.keyboard.press('Digit0');
  await page.waitForSelector('#flat.show', { timeout: 5000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${DIR}/62-demo-flat-listings.png` });
  await page.keyboard.press('Digit0');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('keyboard only: select, sources, down payment, save, inbox, accept, submit, compare', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${MODE}${CITY}`);
  await ready(page);
  await page.evaluate(() => { window.__gpa.clients.reset(); window.__gpa.ctx.saved.clear(); });
  // . selects the next home without a mouse
  await page.keyboard.press('Period');
  await page.waitForFunction(() => window.__gpa.reveal?.id, null, { timeout: 10_000 });
  await page.keyboard.press('Space'); // skip the animation
  await page.waitForFunction(() => window.__gpa.panel?.id, null, { timeout: 10_000 });
  await page.keyboard.press('KeyH'); // every source box
  await expect(page.locator('#ipanel .isrc:not([hidden])').first()).toBeVisible();
  await page.keyboard.press('KeyF'); // save
  await page.waitForFunction(() => window.__gpa.ctx.saved.size === 1, null, { timeout: 5000 });
  // step to a home with a purchase cost and change the down payment
  for (let i = 0; i < 40; i++) {
    if (await page.locator('#ipanel .costbody').count()) break;
    await page.keyboard.press('Period');
    await page.waitForTimeout(350);
  }
  const before = await page.locator('#ipanel .costbody .bigno').getAttribute('data-count');
  await page.keyboard.press('BracketLeft');
  const after = await page.locator('#ipanel .costbody .bigno').getAttribute('data-count');
  expect(Number(after)).toBeGreaterThan(Number(before));
  await page.keyboard.press('Escape');
  // inbox: arrows, Enter opens a client, Enter accepts
  await page.keyboard.press('KeyI');
  await page.waitForSelector('#inbox.show .mlist');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#inbox .accept');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.__gpa.clients.active, null, { timeout: 5000 });
  // select any home and submit with Enter: a result screen with stars and text appears
  await page.keyboard.press('Period');
  await page.waitForSelector('#ipanel.show [data-act="submit"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#cresult.show .rstars', { timeout: 5000 });
  await expect(page.locator('#cresult h2')).toBeVisible();
  await page.waitForTimeout(500); // the Enter that submitted does not also dismiss the result
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__gpa.compare?.open, null, { timeout: 5000 });
  await page.keyboard.press('Tab');
});
