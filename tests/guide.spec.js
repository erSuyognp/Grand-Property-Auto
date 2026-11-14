// Maya's guided room tour: she offers it, shows rooms one at a time with a line built from the
// scan and the listing, asks a question, reacts to the answer, and wraps up with a next step.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';

test('guided tour: offer, rooms one by one, a question per room, the buyer sets the pace, recap', async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${MODE}${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
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
  test.skip(!['W', 'B'].includes(path), `the guided tour needs our own viewer (this home opened in view ${path})`);
  // she plans a route and offers the tour
  await page.waitForFunction(() => window.__gpa.guide?.available === true, null, { timeout: 30_000 });
  const stops = await page.evaluate(() => window.__gpa.guide.stops);
  console.log('route', JSON.stringify(stops));
  expect(stops.length).toBeGreaterThanOrEqual(2);
  await page.waitForFunction(() => window.__gpa.guide.phase === 'offer', null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/80-guide-offer.png` });
  // Q starts it: the first room, a line with real content, and (usually) a question
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => window.__gpa.guide.active && window.__gpa.guide.phase === 'room', null, { timeout: 10_000 });
  const first = await page.evaluate(() => window.__gpa.guide);
  console.log('room 1', first.room, '|', first.line, '|', JSON.stringify(first.choices));
  expect(first.line.length).toBeGreaterThan(30);
  expect(first.line).not.toMatch(/NaN|undefined|null|\[object/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/81-guide-room.png` });
  // walk the whole route: answer when asked (key 1), Enter for the next room
  const seen = [first.room];
  for (let i = 0; i < 10; i++) {
    const g = await page.evaluate(() => window.__gpa.guide);
    if (g.phase === 'recap') break;
    if (g.choices.length) {
      const before = g.line;
      await page.keyboard.press('Digit1');
      await page.waitForFunction((b) => window.__gpa.guide.line !== b && window.__gpa.guide.choices.length === 0, before, { timeout: 5000 });
      const reply = await page.evaluate(() => window.__gpa.guide.line);
      expect(reply).not.toMatch(/NaN|undefined|null|\[object/);
      if (i === 0) { console.log('reply', reply); await page.screenshot({ path: `${DIR}/82-guide-answer.png` }); }
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const now = await page.evaluate(() => window.__gpa.guide);
    if (now.phase === 'room' && now.room) { seen.push(now.room); expect(now.line).not.toMatch(/NaN|undefined|null|\[object/); }
  }
  console.log('rooms shown', JSON.stringify(seen));
  expect(new Set(seen).size).toBe(stops.length);
  // the recap: what stands out, the trade off, and a next step
  await page.waitForFunction(() => window.__gpa.guide.phase === 'recap', null, { timeout: 10_000 });
  const recap = await page.evaluate(() => window.__gpa.guide);
  console.log('recap', recap.line, JSON.stringify(recap.choices));
  expect(recap.choices).toEqual(['I love it', 'Show me the costs', 'Find me a better fit']);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/83-guide-recap.png` });
  await page.keyboard.press('Digit1'); // I love it: saved
  await page.waitForFunction(() => window.__gpa.ctx.saved.size >= 1, null, { timeout: 5000 });
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => !window.__gpa.guide.active, null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  expect(errors, errors.join('\n')).toEqual([]);
});
