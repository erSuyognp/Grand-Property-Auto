// Phase 1 discovery: which Showcase base URL connects with the Embed SDK on localhost.
// Hits Matterport, so it only runs when SHOWCASE_CHECK=<modelId> is set.
import { test } from '@playwright/test';
import fs from 'node:fs';

const model = process.env.SHOWCASE_CHECK;
test.skip(!model, 'set SHOWCASE_CHECK=<modelId> to run');

// bases to try: SHOWCASE_BASES=comma,separated (defaults to the public Showcase host)
for (const base of (process.env.SHOWCASE_BASES || 'https://my.matterport.com').split(',')) {
  test(`showcase connects via ${base}`, async ({ page }) => {
    test.setTimeout(90_000);
    page.on('console', (m) => { if (m.text().includes('[showcase]')) console.log(m.text().slice(0, 300)); });
    await page.goto(`/tools/showcase_test.html?m=${model}&base=${encodeURIComponent(base)}`);
    await page.waitForFunction(() => window.__showcase && window.__showcase.status !== 'starting', null, { timeout: 60_000 });
    const res = await page.evaluate(() => window.__showcase);
    console.log(`RESULT ${base}: ${JSON.stringify(res)}`);
    fs.mkdirSync('data/samples', { recursive: true });
    fs.appendFileSync('data/samples/showcase_check.txt', `${base} ${JSON.stringify(res)}\n`);
    await page.screenshot({ path: `data/samples/showcase_${new URL(base).hostname}.png` });
  });
}
