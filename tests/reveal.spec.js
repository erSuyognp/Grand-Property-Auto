// The property reveal: select a listing, wait for the sequence, check the panel and its cards.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';
const ready = (page) => page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });

test('reveal: select a home, the world animates and the panel slides in', async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0&pace=quick${MODE}${CITY}`);
  await ready(page);
  await page.waitForFunction(() => window.__gpa.ctx.insights.ready, null, { timeout: 15_000 });
  const id = await page.evaluate(() => {
    const g = window.__gpa, rows = g.ctx.insights.rows();
    const pick = rows.find((r) => r.kind === 'sale' && r.solarSave && r.lowerThanPct != null) || rows.find((r) => r.kind === 'sale') || rows[0];
    g.teleportNear(pick.id, 12);
    return pick.id;
  });
  await page.waitForFunction((i) => window.__gpa.ctx.listingsSys.near?.id === i, id, { timeout: 10_000 }).catch(() => {});
  await page.evaluate((i) => window.__gpa.select(i), id);
  await page.waitForTimeout(2300);
  await page.screenshot({ path: `${DIR}/20-reveal-mid.png` });
  await page.waitForFunction(() => window.__gpa.reveal?.stage === 3, null, { timeout: 12_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/21-reveal.png` });
  const panel = await page.evaluate(() => window.__gpa.panel);
  console.log('panel', JSON.stringify(panel), 'fps', await page.evaluate(() => window.__gpa.fps));
  expect(panel.cards).toContain('value');
  expect(panel.cards).toContain('cost');
  expect(panel.cards).toContain('risk');
  // every card has a source button, and no card shows a broken number
  const text = await page.locator('#ipanel').innerText();
  expect(text).not.toMatch(/NaN|undefined|null|Infinity/);
  await page.locator('#ipanel [data-info="cost"]').click();
  await expect(page.locator('#ipanel [data-card="cost"] .isrc')).toBeVisible();
  // the down payment changes the monthly cost
  const before = await page.locator('#ipanel .costbody .bigno').getAttribute('data-count');
  await page.locator('#ipanel [data-down="3.5"]').click();
  const after = await page.locator('#ipanel .costbody .bigno').getAttribute('data-count');
  expect(Number(after)).toBeGreaterThan(Number(before));
  await page.locator('#ipanel .icards').evaluate((n) => { n.scrollTop = 520; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/22-reveal-panel.png` });
  await page.locator('#ipanel .icards').evaluate((n) => { n.scrollTop = 1500; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/23-reveal-panel2.png` });
  // Esc closes and the car is back
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__gpa.reveal, null, { timeout: 5_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reveal, step by step: Maya tells it in her voice (no caption), the map follows, Space moves on', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${MODE}${CITY}`);
  await ready(page);
  await page.waitForFunction(() => window.__gpa.ctx.insights.ready, null, { timeout: 15_000 });
  const id = await page.evaluate(() => { const g = window.__gpa, r = g.ctx.insights.rows().find((x) => x.kind === 'sale' && x.solarSave) || g.ctx.insights.rows()[0]; g.teleportNear(r.id, 12); return r.id; });
  await page.evaluate((i) => { window.__gpa.select(i); }, id);
  // the story starts with the home, then the walk rings, then places one at a time
  await page.waitForFunction(() => window.__gpa.revealStep?.i >= 2, null, { timeout: 10_000 });
  // voice only: no caption on the map, and she is talking
  expect(await page.locator('#reveal-cap').count()).toBe(0);
  expect(await page.evaluate(() => window.__gpa.maya?.state)).toBe('talking');
  const total = await page.evaluate(() => window.__gpa.revealStep.n);
  expect(total).toBeGreaterThanOrEqual(5);
  // the panel has not arrived yet: the world is shown first
  expect(await page.locator('#ipanel.show').count()).toBe(0);
  await page.waitForFunction(() => window.__gpa.revealStep.i >= 4, null, { timeout: 30_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/24-reveal-step.png` });
  console.log('step', JSON.stringify(await page.evaluate(() => window.__gpa.revealStep)));
  // Space jumps to the next step
  const before = await page.evaluate(() => window.__gpa.revealStep.i);
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => window.__gpa.revealStep.i > b, before, { timeout: 5000 });
  // Shift+Space skips to the end
  await page.keyboard.press('Shift+Space');
  await page.waitForFunction(() => window.__gpa.reveal?.stage === 3, null, { timeout: 8000 });
  await expect(page.locator('#ipanel.show')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
