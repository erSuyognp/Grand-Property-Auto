// Maya, the voice agent: a transcript goes in, a tool is called, captions appear.
// Works with the model on (LLM_ENABLED=true) or on her scripted lines.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';
const ready = (page) => page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });

async function open(page, extra = '') {
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${MODE}${CITY}${extra}`);
  await ready(page);
  await page.waitForFunction(() => window.__gpa.ctx.insights.ready, null, { timeout: 15_000 });
  const id = await page.evaluate(() => {
    const g = window.__gpa, rows = g.ctx.insights.rows();
    const pick = rows.find((r) => r.kind === 'sale' && r.cost && r.lowerThanPct != null) || rows[0];
    g.teleportNear(pick.id, 12);
    return pick.id;
  });
  await page.evaluate((i) => window.__gpa.select(i, true), id);
  await page.waitForFunction(() => window.__gpa.panel?.id, null, { timeout: 10_000 });
  return id;
}

test('maya: "is this a good deal and what would I pay per month" calls a tool and shows captions', async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(() => { window.__gpa.ctx.maya.hear('is this a good deal and what would I pay per month'); });
  await page.waitForFunction(() => (window.__gpa.maya?.tools || []).length > 0 && (window.__gpa.maya.caption || '').length > 8 && !/^“/.test(window.__gpa.maya.caption), null, { timeout: 40_000 });
  const m = await page.evaluate(() => window.__gpa.maya);
  console.log('maya', JSON.stringify({ source: m.source, tools: m.tools, caption: m.caption, latencyMs: m.latencyMs }));
  expect(m.tools.some((t) => ['get_property', 'monthly_cost'].includes(t))).toBe(true);
  await expect(page.locator('#maya .mbubble')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/30-maya.png` });
  // a better option: she offers one and the cards appear
  await page.waitForFunction(() => window.__gpa.maya.state === 'idle', null, { timeout: 40_000 });
  await page.evaluate(() => { window.__gpa.ctx.maya.hear('show me something cheaper with a park nearby'); });
  await page.waitForFunction(() => (window.__gpa.maya?.alts || []).length > 0, null, { timeout: 40_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/31-maya-better.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('maya: questions about people are answered with facts about the place', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, '&mayascript=1');
  await page.evaluate(() => { window.__gpa.ctx.maya.hear('is this a safe area?'); });
  await page.waitForFunction(() => !/^“/.test(window.__gpa.maya?.caption || '“') && window.__gpa.maya.state !== 'thinking', null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__gpa.maya.state === 'idle', null, { timeout: 30_000 });
  const said = await page.evaluate(() => window.__gpa.ctx.maya.state.history.slice(-1)[0].content);
  console.log('maya said:', said);
  expect(said).toMatch(/can't speak to who lives/i);
  expect(said).not.toMatch(/\b(is|very|quite|pretty) safe\b|unsafe|good neighborhood|bad area|family friendly/i);
});
