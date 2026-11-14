// Drone view: for the homes that came with an exterior Gaussian splat (a drone flew around
// them), Q while parked there fades the city out and slowly orbits the real house from the
// air, with the listing card still on screen. Esc goes back to the car.
// The splat is drawn with @mkkellogg/gaussian-splats-3d (MIT) in its own scene.
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

export function initDrone(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9c8e6);
  const cam = new THREE.PerspectiveCamera(48, 1, 0.3, 600);
  const D = { active: false, loading: false, viewer: null, listing: null, angle: 0, meta: null, token: 0, t: 0 };

  const label = document.createElement('div');
  label.id = 'drone-label';
  label.innerHTML = '<b>Drone view</b><span>The real house, rebuilt from a drone flight</span><kbd>Esc</kbd> back to the car';
  document.body.append(label);

  function available(l) { return !!(l && l.splat && !ctx.mock); }

  async function enter(l) {
    if (D.active || D.loading || !available(l) || ctx.state !== 'play') return;
    const token = ++D.token;
    D.loading = true; D.listing = l; D.meta = l.splat;
    const s = ctx.car.state;
    s.vx = s.vz = 0;
    ctx.audio.chime();
    await ctx.hud.fade(true, 450);
    if (token !== D.token) return;
    ctx.state = 'drone';
    ctx.skipRender = true;
    document.body.classList.add('drone');
    // no shared memory (that needs special server headers); the sort runs in a worker
    const viewer = new GaussianSplats3D.DropInViewer({ gpuAcceleratedSort: false, sharedMemoryForWorkers: false, sphericalHarmonicsDegree: 0 });
    scene.add(viewer);
    D.viewer = viewer;
    D.angle = Math.random() * 6.28; D.t = 0;
    try {
      await viewer.addSplatScene(ctx.world.base + l.splat.file, {
        format: GaussianSplats3D.SceneFormat.Splat, showLoadingUI: false, splatAlphaRemovalThreshold: 12,
        rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], // the splat is z up
      });
    } catch (e) {
      console.warn('[drone] splat failed to load:', e.message);
      if (token === D.token) { D.loading = false; D.active = true; await exit(); ctx.hud.toast('Drone view is not available for this home'); }
      return;
    }
    if (token !== D.token) return;
    D.loading = false; D.active = true;
    window.__gpa.drone = { active: true, count: l.splat.count };
    ctx.emit('drone', true);
    await ctx.hud.fade(false, 600);
  }

  async function exit() {
    if (!D.active && !D.loading) return;
    D.token++;
    await ctx.hud.fade(true, 300);
    if (D.viewer) {
      scene.remove(D.viewer);
      try { await D.viewer.dispose(); } catch { /* already gone */ }
      D.viewer = null;
    }
    D.active = false; D.loading = false;
    document.body.classList.remove('drone');
    ctx.skipRender = false;
    ctx.state = 'play';
    ctx.cam.snap();
    window.__gpa.drone = null;
    ctx.emit('drone', false);
    await ctx.hud.fade(false, 400);
  }

  ctx.on('post', (dt) => {
    if (!D.active || !D.viewer) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    D.t += dt;
    D.angle += dt * 0.11;
    const m = D.meta;
    const r = m.radius * 1.35 + 14, y = m.height * 0.9 + 9 + Math.sin(D.t * 0.21) * 2.5;
    cam.position.set(Math.cos(D.angle) * r, y, Math.sin(D.angle) * r);
    cam.lookAt(0, m.height * 0.3, 0);
    ctx.renderer.render(scene, cam);
  });

  ctx.on('key', (code) => {
    if (code === 'Escape' && (D.active || D.loading)) exit();
    if (code === 'KeyQ' && ctx.state === 'play' && !ctx.hud.choosing) {
      const l = ctx.listingsSys.near;
      if (available(l) && Math.abs(ctx.car.state.speed) < 3) enter(l);
      else if (available(l)) ctx.hud.toast('Stop the car for the drone view');
    }
  });
  ctx.on('city-unload', () => { if (D.active || D.loading) exit(); });

  return { enter, exit, available, state: D, get active() { return D.active; } };
}
