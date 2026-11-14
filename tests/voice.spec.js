// Voice input when the browser's own speech recognition cannot reach its service: the mic is
// recorded while V is held and transcribed through /api/stt. The test gives Chromium a fake
// microphone that plays a spoken sentence (made once with the voice service), holds V, and
// expects the words back. Skipped when the server has no voice key.
import 'dotenv/config';
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WAV = path.resolve('test-results', 'fake-mic.wav');
const SAID = 'Find me a three bedroom home near a park.';

function wav(pcm, rate = 16000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

test.use({ launchOptions: { args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`] } });

test.beforeAll(async () => {
  const key = process.env.ELEVENLABS_API_KEY || process.env.TTS_API_KEY || '';
  if (!key.startsWith('sk_') || fs.existsSync(WAV)) return;
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=pcm_16000', { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text: SAID, model_id: 'eleven_flash_v2_5' }) });
  if (!r.ok) return;
  fs.mkdirSync(path.dirname(WAV), { recursive: true });
  // a second of silence after the sentence, so the looping fake mic has a gap
  fs.writeFileSync(WAV, wav(Buffer.concat([Buffer.from(await r.arrayBuffer()), Buffer.alloc(32000)])));
});

test('voice: hold V, the recorded clip is transcribed and reaches the game', async ({ page }) => {
  test.setTimeout(90_000);
  const cfg = await (await page.request.get('http://localhost:8787/api/config')).json();
  test.skip(!cfg.stt || !fs.existsSync(WAV), 'no voice key on the server, or the test clip could not be made');
  await page.goto('/?autostart=1&mute=1&noshowcase=1&tiles=0&stt=record');
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__gpa.ctx.voice.mode)).toBe('record');
  await page.keyboard.down('KeyV');
  await page.waitForFunction(() => window.__gpa.ctx.voice.listening, null, { timeout: 5000 });
  await page.waitForTimeout(4200);
  await page.keyboard.up('KeyV');
  await page.waitForFunction(() => !!window.__gpa.lastHeard, null, { timeout: 20_000 });
  const heard = await page.evaluate(() => window.__gpa.lastHeard);
  console.log('heard', JSON.stringify(heard));
  expect(heard.text.toLowerCase()).toMatch(/bedroom|park/);
});

test('voice: a browser speech "network" error switches to recording instead of giving up', async ({ page }) => {
  test.setTimeout(90_000);
  const cfg = await (await page.request.get('http://localhost:8787/api/config')).json();
  test.skip(!cfg.stt || !fs.existsSync(WAV), 'no voice key on the server, or the test clip could not be made');
  // a stand-in speech recognizer that fails the way an unreachable speech service does
  await page.addInitScript(() => {
    window.webkitSpeechRecognition = window.SpeechRecognition = class {
      start() { setTimeout(() => this.onerror?.({ error: 'network' }), 150); }
      stop() { this.onend?.(); }
      abort() {}
    };
    try { sessionStorage.removeItem('gpa-voice-mode'); } catch { /* fine */ }
  });
  await page.goto('/?autostart=1&mute=1&noshowcase=1&tiles=0');
  await page.waitForFunction(() => window.__gpa?.ready === true, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__gpa.ctx.voice.mode)).toBe('browser');
  await page.keyboard.down('KeyV');
  await page.waitForFunction(() => window.__gpa.ctx.voice.mode === 'record' && window.__gpa.ctx.voice.listening, null, { timeout: 8000 });
  await page.waitForTimeout(4200);
  await page.keyboard.up('KeyV');
  await page.waitForFunction(() => !!window.__gpa.lastHeard, null, { timeout: 20_000 });
  expect((await page.evaluate(() => window.__gpa.lastHeard)).text.length).toBeGreaterThan(8);
  await expect(page.locator('#toast.show')).toHaveCount(0);
});

test('voice out: Maya answers in her streamed voice, and it starts promptly', async ({ page }) => {
  test.setTimeout(90_000);
  const cfg = await (await page.request.get('http://localhost:8787/api/config')).json();
  test.skip(!cfg.mayaTts, 'no voice key on the server');
  await page.goto('/?autostart=1&noshowcase=1&tiles=0');
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
  await page.evaluate(() => { const g = window.__gpa, r = g.ctx.insights.rows().find((x) => x.kind === 'sale') || g.ctx.insights.rows()[0]; g.teleportNear(r.id, 12); return g.select(r.id, true); });
  await page.waitForFunction(() => window.__gpa.panel?.id, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__gpa.ctx.maya.hear('how far is the nearest park?'); });
  await page.waitForFunction(() => window.__gpa.maya.latencyMs != null, null, { timeout: 30_000 });
  const m = await page.evaluate(() => ({ ms: window.__gpa.maya.latencyMs, voice: window.__gpa.maya.voice, source: window.__gpa.maya.source }));
  console.log('maya voice', JSON.stringify(m));
  expect(m.voice).toBe('stream');
  expect(m.ms).toBeLessThan(9000); // about 2.3 s alone; slower when other tests share the machine and the APIs
  await page.evaluate(() => window.__gpa.ctx.maya.interrupt());
});

test('live: V starts a conversation with the ElevenLabs agent, she hears the mic, uses a tool and answers', async ({ page }) => {
  test.setTimeout(150_000);
  const cfg = await (await page.request.get('http://localhost:8787/api/config')).json();
  test.skip(!cfg.mayaAgent || !fs.existsSync(WAV), 'no agent id or voice key on the server');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart=1&noshowcase=1&tiles=0');
  await page.waitForFunction(() => window.__gpa?.ready === true && window.__gpa.ctx.insights.ready, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__gpa.mayaLive.available)).toBe(true);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.__gpa.mayaLive.status === 'connected', null, { timeout: 30_000 });
  // the fake mic keeps saying "Find me a three bedroom home near a park."
  await page.waitForFunction(() => window.__gpa.mayaLive.heard.length > 8, null, { timeout: 45_000 });
  await page.waitForFunction(() => window.__gpa.mayaLive.tools.length > 0 && window.__gpa.mayaLive.said.length > 8, null, { timeout: 60_000 });
  const live = await page.evaluate(() => window.__gpa.mayaLive);
  console.log('live', JSON.stringify({ heard: live.heard, tools: live.tools, said: live.said.slice(0, 160) }));
  await page.screenshot({ path: `${process.env.SHOT_DIR || 'shots'}/70-maya-live.png` });
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.__gpa.mayaLive.status === 'off', null, { timeout: 15_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
