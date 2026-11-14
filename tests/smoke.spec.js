import { test, expect } from '@playwright/test';

test('server health responds', async ({ request }) => {
  const res = await request.get('http://localhost:8787/api/health');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).ok).toBe(true);
});
