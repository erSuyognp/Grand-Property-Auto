// Which graphics card does a browser page land on? Run: node tools/gpu_probe.mjs
// Prints the WebGL renderer with and without the flag that asks for the fast card.
import { chromium } from 'playwright';
const page_gpu = async (args, channel) => {
  const b = await chromium.launch({ headless: process.env.HEADED ? false : true, channel, args });
  const p = await b.newPage();
  const r = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
    const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none';
  });
  await b.close();
  return r;
};
for (const [name, args, channel] of [
  ['default', ['--use-gl=angle', '--ignore-gpu-blocklist']],
  ['forced', ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_high_performance_gpu']],
  ['chrome forced', ['--force_high_performance_gpu'], 'chrome'],
  ['chrome default', [], 'chrome'],
]) {
  try { console.log(name.padEnd(15), await page_gpu(args, channel)); } catch (e) { console.log(name.padEnd(15), 'failed:', String(e.message).split('\n')[0]); }
}
