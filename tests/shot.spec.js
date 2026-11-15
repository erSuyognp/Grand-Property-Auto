// `npm run shot`: open the game, wait for the world, drive forward 3 s, then walk through
// the main moments (card, mission, tour, saved homes) and save a screenshot of each to shots/.
// SHOT_MODE=mock forces the synthetic neighborhood; SHOT_CITY picks a city; SHOT_DIR the folder.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const MODE = process.env.SHOT_MODE ? `&mode=${process.env.SHOT_MODE}` : '';
const CITY = process.env.SHOT_CITY ? `&city=${process.env.SHOT_CITY}` : '';
const DIR = process.env.SHOT_DIR || 'shots';
// SHOT_TILES=1 shoots the Google 3D city (needs the key and internet); the default is the
// block city, which is the same on every run
const TILES = process.env.SHOT_TILES ? '&tiles=1' : '&tiles=0';
const ready = (page) => page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });

test('shot: title screen', async ({ page }) => {
  fs.mkdirSync(DIR, { recursive: true });
  await page.goto(`/?mute=1&nocover=1${MODE}${CITY}${TILES}`);
  await ready(page);
  // public (mock) shots: do not show the laptop's network address or a scannable code
  if (process.env.SHOT_MODE === 'mock') await page.addStyleTag({ content: '#qr .inner { display: none !important; }' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/00-title.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 15_000 });
});

test('shot: load and drive', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`/?autostart=1&mute=1&noshowcase=1${MODE}${CITY}${TILES}`);
  await ready(page);
  if (process.env.SHOT_TILES) {
    await page.waitForFunction(() => { const t = window.__gpa.tiles(); return t.on || t.failed; }, null, { timeout: 20_000 });
    console.log('tiles', JSON.stringify(await page.evaluate(() => window.__gpa.tiles())));
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/01-loaded.png` });

  const start = await page.evaluate(() => ({ ...window.__gpa.car }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${DIR}/02-driven.png` });
  const end = await page.evaluate(() => {
    const g = window.__gpa, c = g.ctx.car.state;
    return { ...g.car, fps: g.fps, inside: !!g.ctx.world.buildingAt(c.x, c.z), buildings: g.buildings, listings: g.listings, gpu: g.quality.gpu };
  });
  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  console.log(`moved ${moved.toFixed(1)} m, fps ${end.fps}, ${end.buildings} buildings, ${end.listings} listings, gpu ${end.gpu}`);
  expect(moved).toBeGreaterThan(5);
  expect(end.inside).toBe(false);

  // top down view
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/03-topdown.png` });
  await page.keyboard.press('KeyC');

  // pull up to a listing: the card slides in
  await page.evaluate(() => {
    const g = window.__gpa;
    const l = g.ctx.world.listings.find((x) => x.kind === 'sale' && x.matterportIds.length) || g.ctx.world.listings[0];
    g.teleportNear(l.id, 10);
  });
  await page.waitForFunction(() => !!window.__gpa.ctx.listingsSys.near, null, { timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/04-card.png` });

  // voice mission
  await page.evaluate(() => window.__gpa.say('three bedrooms under 900k with a pool'));
  await page.waitForFunction(() => window.__gpa.mission().ribbon === true, null, { timeout: 15_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/05-mission.png` });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/06-mission-top.png` });
  await page.keyboard.press('KeyC');

  // walk inside (own viewer here; the Showcase path has its own test)
  await page.evaluate(() => {
    const g = window.__gpa;
    const l = g.ctx.world.listings.find((x) => x.id === g.mission().target);
    g.teleportNear(l.id, 10);
  });
  await page.waitForFunction(() => window.__gpa.ctx.listingsSys.near?.id === window.__gpa.mission().target, null, { timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyE'); // select the home (the reveal)
  await page.waitForFunction(() => window.__gpa.reveal?.id, null, { timeout: 10_000 });
  await page.keyboard.press('KeyE'); // walk inside
  await page.waitForTimeout(700);
  // an apartment community asks which space to walk into first: take the community itself
  await page.evaluate(() => {
    const g = window.__gpa;
    if (g.ctx.hud.choosing) { g.ctx.hud.closeChooser(); g.ctx.tour.enter(g.ctx.listingsSys.near); }
  });
  await page.waitForFunction(() => window.__gpa.tour && window.__gpa.tour.path, null, { timeout: 30_000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${DIR}/07-tour.png` });
  const tour = await page.evaluate(() => window.__gpa.tour);
  console.log('tour', JSON.stringify(tour));
  if (tour.path === 'B') {
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/08-tour-empty.png` });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/09-rate.png` });
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/10-saved.png` });
  await page.keyboard.press('Tab');

  // the map
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__gpa.map?.open === true, null, { timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/12-map.png` });
  // hover the first large dot (a home or business for sale): its price shows
  const dot = await page.evaluate(() => {
    const pts = window.__gpa.ctx.bigmap.points(), p = pts.find((x) => x.kind === 'sale') || pts.find((x) => x.kind === 'bizsale') || pts[0];
    const r = document.querySelector('#bigmap canvas').getBoundingClientRect();
    return p ? { x: r.left + (p.x / 1600) * r.width, y: r.top + (p.y / 1600) * r.height } : null;
  });
  if (dot) {
    await page.mouse.move(dot.x, dot.y);
    await page.waitForTimeout(300);
    console.log('map', JSON.stringify(await page.evaluate(() => window.__gpa.map)));
    await page.screenshot({ path: `${DIR}/13-map-hover.png` });
    await page.mouse.move(5, 5);
  }
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__gpa.state === 'play', null, { timeout: 5_000 });

  const fps = await page.evaluate(() => window.__gpa.fps);
  console.log(`final fps ${fps}`);
  expect(errors, errors.join('\n')).toEqual([]);
});
