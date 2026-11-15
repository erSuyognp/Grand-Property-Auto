// Maya's guided room tour: she starts it herself, walks to each room (turn, then a dissolve to
// the next spot, never a jump across the home), says a line built from the scan and the
// listing, asks a question once she has finished the sentence, reacts to the answer, moves on
// by herself when the buyer is quiet, and wraps up with a next step.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';
const BROKEN = /NaN|undefined|\bnull\b|\[object/;

async function enter(page, extra = '') {
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&tiles=0${extra}${MODE}${CITY}`);
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
  const ok = await page.evaluate(async () => {
    const g = window.__gpa;
    const l = g.ctx.world.listings.find((x) => x.kind !== 'apartments' && x.matterportIds.length) || g.ctx.world.listings.find((x) => x.matterportIds.length);
    if (!l) return false;
    g.teleportNear(l.id, 10);
    await g.ctx.tour.enter(l);
    return true;
  });
  if (!ok) return null;
  await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path, null, { timeout: 30_000 });
  return page.evaluate(() => window.__gpa.tour.path);
}

test('guided tour: Maya leads on her own, room by room, with a question in each and a recap', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const path = await enter(page);
  test.skip(!path, 'no home with a 3D scan in this data set');
  test.skip(!['W', 'B'].includes(path), `the guided tour needs our own viewer (this home opened in view ${path})`);
  // she starts by herself: a hello, then she walks to the first room
  await page.waitForFunction(() => window.__gpa.guide?.active === true, null, { timeout: 40_000 });
  const stops = await page.evaluate(() => window.__gpa.guide.stops);
  console.log('route', JSON.stringify(stops));
  expect(stops.length).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__gpa.guide.line)).toMatch(/Welcome in/);
  await page.screenshot({ path: `${DIR}/80-guide-hello.png` });
  await page.waitForFunction(() => window.__gpa.guide.phase === 'room', null, { timeout: 60_000 });
  // she was walked there, not dropped there: the view is at one of that room's scan points and standing still
  expect(await page.evaluate(() => { const g = window.__gpa; return g.ctx.guide.stops[g.guide.i].panos.includes(g.ctx.tour._state.pano); })).toBe(true);
  const first = await page.evaluate(() => window.__gpa.guide);
  console.log('room 1', first.room, '|', first.line);
  expect(first.line.length).toBeGreaterThan(30);
  expect(first.line).not.toMatch(BROKEN);
  await page.waitForTimeout(2500);
  if (path === 'W') console.log('photo tier', JSON.stringify(await page.evaluate(() => { const i = window.__gpa.ctx.tour.walk.info(); return { tier: i.hiTier || '1k', sharpLoaded: i.sharp }; })));
  await page.screenshot({ path: `${DIR}/81-guide-room.png` });

  const seen = [first.room];
  for (let n = 0; n < 12; n++) {
    let g = await page.evaluate(() => window.__gpa.guide);
    if (g.phase === 'recap') break;
    // the question shows once she has finished speaking; answer it when there is one
    await page.waitForFunction(() => window.__gpa.guide.choices.length > 0 || window.__gpa.guide.phase !== 'room' || window.__gpa.ctx.guide.asked === false, null, { timeout: 15_000 }).catch(() => {});
    g = await page.evaluate(() => window.__gpa.guide);
    if (g.phase === 'room' && g.choices.length) {
      const before = g.line;
      await page.keyboard.press('Digit1');
      await page.waitForFunction((b) => window.__gpa.guide.line !== b, before, { timeout: 5000 });
      const reply = await page.evaluate(() => window.__gpa.guide.line);
      expect(reply).not.toMatch(BROKEN);
      if (n === 0) { console.log('reply', reply); await page.screenshot({ path: `${DIR}/82-guide-answer.png` }); }
    }
    if (g.phase === 'room') await page.keyboard.press('Enter');
    // walking: a line on the way, then the next room (or the recap)
    await page.waitForFunction((r) => { const x = window.__gpa.guide; return x.phase === 'recap' || (x.phase === 'room' && x.room !== r); }, g.room, { timeout: 60_000 });
    const now = await page.evaluate(() => window.__gpa.guide);
    if (now.phase === 'room') { seen.push(now.room); expect(now.line).not.toMatch(BROKEN); if (seen.length === 2) { await page.waitForTimeout(900); await page.screenshot({ path: `${DIR}/83-guide-room2.png` }); } }
  }
  console.log('rooms shown', JSON.stringify(seen));
  expect(new Set(seen).size).toBe(stops.length);
  await page.waitForFunction(() => window.__gpa.guide.phase === 'recap' && window.__gpa.guide.choices.length === 3, null, { timeout: 30_000 });
  const recap = await page.evaluate(() => window.__gpa.guide);
  console.log('recap', recap.line);
  expect(recap.choices).toEqual(['I love it', 'Show me the costs', 'Find me a better fit']);
  await page.screenshot({ path: `${DIR}/84-guide-recap.png` });
  await page.keyboard.press('Digit1'); // I love it: saved
  await page.waitForFunction(() => window.__gpa.ctx.saved.size >= 1, null, { timeout: 5000 });
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => !window.__gpa.guide.active, null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('guided tour: she moves on by herself when the buyer is quiet, and can be set to ask first', async ({ page }) => {
  test.setTimeout(240_000);
  let path = await enter(page);
  test.skip(!path || !['W', 'B'].includes(path), 'needs a home that opens in our own viewer');
  await page.waitForFunction(() => window.__gpa.guide?.phase === 'room', null, { timeout: 90_000 });
  const first = await page.evaluate(() => window.__gpa.guide.room);
  // nobody touches anything: after her question and a pause she says "no rush", then walks on
  await page.waitForFunction((r) => window.__gpa.guide.phase === 'room' && window.__gpa.guide.room !== r, first, { timeout: 90_000 });
  console.log('moved on from', first, 'to', await page.evaluate(() => window.__gpa.guide.room));
  // "Ask me first": she offers instead of starting
  path = await enter(page, '&guide=ask');
  await page.waitForFunction(() => window.__gpa.guide?.phase === 'offer', null, { timeout: 40_000 });
  expect(await page.evaluate(() => window.__gpa.guide.active)).toBe(false);
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => window.__gpa.guide.active, null, { timeout: 10_000 });
});
