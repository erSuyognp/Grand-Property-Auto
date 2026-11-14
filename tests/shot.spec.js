// `npm run shot`: open the game, wait for the world, drive forward 3 s, save screenshots.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('shot: load and drive', async ({ page }) => {
  fs.mkdirSync('shots', { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/01-loaded.png' });

  const start = await page.evaluate(() => ({ ...window.__gpa.car }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: 'shots/02-driven.png' });
  const end = await page.evaluate(() => ({ ...window.__gpa.car, fps: window.__gpa.fps }));

  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  console.log(`moved ${moved.toFixed(1)} m, fps ${end.fps}`);
  expect(errors, errors.join('\n')).toEqual([]);
  expect(moved).toBeGreaterThan(5);
});
