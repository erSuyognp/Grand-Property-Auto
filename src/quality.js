// Render quality tiers. The OS decides which graphics card the browser runs on, so the game
// reads the card it actually got and scales the picture to it:
//   low    software rendering or ?q=low: no shadows, no bloom, 1x resolution
//   high   integrated graphics (the Radeon 780M): what the game was tuned on
//   ultra  a discrete card (the RTX): supersampling, 4x multisampling on the HDR frame,
//          ambient occlusion, a 4096 px sun shadow, finer Google tiles and a larger tile cache
// Force one with ?quality=low|high|ultra. The frame rate guard in main.js still steps down
// when a tier turns out too heavy.
const TIERS = {
  low: {
    label: 'LOW', msaa: 0, smaa: false, bloom: false, ao: false, shadows: false, shadowMap: 1024, shadowSpan: 95,
    aniso: 4, traffic: 4, tileStart: 28, tileFloor: 16, tileCacheGB: 0.5, tileCount: 6000, tileJobs: 1,
  },
  high: {
    label: 'HIGH', msaa: 0, smaa: true, bloom: true, ao: false, shadows: true, shadowMap: 2048, shadowSpan: 95,
    aniso: 8, traffic: 9, tileStart: 24, tileFloor: 6, tileCacheGB: 1.0, tileCount: 12000, tileJobs: 1,
  },
  ultra: {
    label: 'ULTRA', msaa: 4, smaa: true, bloom: true, ao: true, shadows: true, shadowMap: 4096, shadowSpan: 130,
    aniso: 16, traffic: 14, tileStart: 10, tileFloor: 3, tileCacheGB: 3.0, tileCount: 30000, tileJobs: 2,
  },
};

const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;
const DISCRETE = /rtx|gtx|geforce|quadro|radeon rx|radeon pro|arc\(tm\) [ab]\d|arc [ab]\d/i;

export function pickQuality(renderer, params) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const software = SOFTWARE.test(gpu);
  let tier = software ? 'low' : DISCRETE.test(gpu) ? 'ultra' : 'high';
  if (params.get('q') === 'low') tier = 'low';
  if (params.get('q') === 'high' && software) tier = 'high';
  if (TIERS[params.get('quality')]) tier = params.get('quality');
  const t = TIERS[tier];
  const dpr = window.devicePixelRatio || 1;
  // ultra renders above the screen's own resolution when the screen is not already dense
  const pixelRatio = tier === 'low' ? 1 : tier === 'ultra' ? Math.min(2, Math.max(dpr, 1.5)) : Math.min(dpr, 2);
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Laptop GPU (0x...) Direct3D11 ...)" -> "GeForce RTX 5060"
  const name = (gpu.split(',')[1] || gpu).replace(/\(0x[0-9a-f]+\).*$/i, '').replace(/\b(NVIDIA|AMD|Intel\(R\)|Laptop GPU|Graphics)\b/g, '').replace(/\s+/g, ' ').trim();
  return { ...t, tier, gpu, gpuName: name, low: tier === 'low', ultra: tier === 'ultra', pixelRatio };
}
