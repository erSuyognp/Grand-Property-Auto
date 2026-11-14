// Before and after pictures of the same two spots with the Google 3D city on, for judging
// visual changes one at a time. QUALITY=<tag> names the pictures: shots/q/<tag>-a.png (the
// spawn point, standing still) and <tag>-b.png (after driving forward 2.5 s and stopping).
import { test } from '@playwright/test';
import fs from 'node:fs';

test.skip(!process.env.QUALITY, 'set QUALITY=<tag> to run (needs the Google key and internet)');

test('quality shots', async ({ page }) => {
  test.setTimeout(150_000);
  const tag = process.env.QUALITY;
  fs.mkdirSync('shots/q', { recursive: true });
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
  await page.goto(`/?autostart=1&mute=1&noshowcase=1&notraffic&city=${process.env.SHOT_CITY || 'houston'}&tiles=${process.env.QUALITY_TILES || 1}`);
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  if ((process.env.QUALITY_TILES || '1') === '1') await page.waitForFunction(() => { const t = window.__gpa.tiles(); return t.on || t.failed; }, null, { timeout: 20_000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `shots/q/${tag}-a.png` });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `shots/q/${tag}-b.png` });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3500);
  const moving = await page.evaluate(() => window.__gpa.fps);
  await page.screenshot({ path: `shots/q/${tag}-c.png` });
  await page.keyboard.up('KeyW');
  console.log(`[q] ${tag}: fps moving ${moving}, now ${await page.evaluate(() => window.__gpa.fps)}, tiles ${JSON.stringify(await page.evaluate(() => window.__gpa.tiles()))}`);
});
