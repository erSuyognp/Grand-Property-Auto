import { test, expect } from '@playwright/test';
import { inDataWindow } from '../server/dataWindow.js';

test('server health responds', async ({ request }) => {
  const res = await request.get('http://localhost:8787/api/health');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).ok).toBe(true);
});

test('config never leaks server secrets', async ({ request }) => {
  const cfg = await (await request.get('http://localhost:8787/api/config')).json();
  expect(['real', 'mock']).toContain(cfg.mode);
  expect(Object.keys(cfg).sort()).toEqual(['llm', 'matterportSdkKey', 'mode', 'showcaseBase']);
});

test('data window: Nov 13 4:30 PM to Nov 15 4:00 PM ET', () => {
  expect(inDataWindow(new Date('2026-11-13T16:29:59-05:00'))).toBe(false);
  expect(inDataWindow(new Date('2026-11-13T16:30:00-05:00'))).toBe(true);
  expect(inDataWindow(new Date('2026-11-15T15:59:59-05:00'))).toBe(true);
  expect(inDataWindow(new Date('2026-11-15T16:00:00-05:00'))).toBe(false);
});

test('?mode=mock forces mock mode', async ({ page }) => {
  await page.goto('/?mode=mock');
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__gpa.mode)).toBe('mock');
});
