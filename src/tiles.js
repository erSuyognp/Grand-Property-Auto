// The visible city as Google Photorealistic 3D Tiles (NASA 3DTilesRendererJS). The tiles
// replace what you see; everything you can do still runs on our own data: the Vexcel
// footprints stay as invisible walls, and markers, beams, cards and routes hang off them.
//
// - Placed with the reorientation plugin at the area center, then turned half a turn so
//   east is +x and south is +z like src/geo.js.
// - Unlit (the photos already hold the light), no shadows on them. A small shadow catcher
//   under the car keeps the car's own shadow.
// - The ground under the car comes from rays cast down onto the tiles, cached per cell.
// - G switches between this and the block city. No key, mock mode, or nothing on screen
//   within six seconds: the block city comes back by itself.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, ReorientationPlugin, TilesFadePlugin, GLTFExtensionsPlugin, TileCompressionPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const LOAD_TIMEOUT = 6000;
const CELL = 1.5, TTL = 7000, RAY_BUDGET = 8;

export function initTiles(ctx) {
  const key = ctx.config.googleMapsKey || '';
  const allowed = !!key && !ctx.mock && !ctx.params.has('notiles') && ctx.params.get('tiles') !== '0';
  let wanted = allowed;
  try { if (localStorage.getItem('gpa-city3d') === 'off') wanted = false; } catch { /* private mode */ }
  if (ctx.params.get('tiles') === '1') wanted = allowed;

  const S = {
    on: false, loading: false, failed: '', tiles: null, holder: null, models: 0, calibrated: 0,
    errorTarget: 24, city: null, timer: 0, materials: new Set(), startedAt: 0,
  };
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const DOWN = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3(), view = new THREE.Vector3();
  const cache = new Map();
  let budget = RAY_BUDGET, terrainAt = null;
  // Photo colors untouched: the frame goes through filmic tone mapping in post (the sky and
  // the car need it), so each tile pixel is run through the exact inverse first. What comes
  // out of the pipeline is the photo's own color. gpaGain only moves at dusk and night.
  const U = { gpaExposure: { value: 0.46 }, gpaGain: { value: new THREE.Color(1, 1, 1) } };
  const gain = U.gpaGain.value;
  const maxAniso = ctx.renderer.capabilities.getMaxAnisotropy();
  const UNTONE = `
    uniform float gpaExposure; uniform vec3 gpaGain;
    vec3 gpaUntone(vec3 c) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      vec3 y = clamp(inverse(outM) * clamp(c, 0.0, 0.985), 0.0, 0.985);
      vec3 A = 0.983729 * y - 1.0, B = 0.4329510 * y - 0.0245786, C = 0.238081 * y + 0.000090537;
      vec3 v = (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
      return max(inverse(inM) * v, 0.0) * (0.6 / gpaExposure);
    }`;
  function untone(m) {
    if (m.userData.gpa) return;
    m.userData.gpa = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev(shader, renderer);
      Object.assign(shader.uniforms, U);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + UNTONE)
        .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = gpaUntone(diffuseColor.rgb) * gpaGain;');
    };
    m.needsUpdate = true;
  }

  // attribution, required by the Map Tiles terms: logo and data credits, always visible
  const credit = document.createElement('div');
  credit.id = 'g-attr';
  credit.innerHTML = '<img alt="Google" src="https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_light_color_68x28dp.png" onerror="this.replaceWith(Object.assign(document.createElement(\'b\'),{textContent:\'Google\'}))"/><span></span>';
  document.body.append(credit);

  // the car's shadow needs something to land on now that the ground is a photo
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.42, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  catcher.receiveShadow = true;
  catcher.visible = false;
  catcher.renderOrder = 1;
  ctx.scene.add(catcher);

  let loaders = null;
  function gltfLoaders() {
    if (!loaders) {
      const draco = new DRACOLoader().setDecoderPath('/libs/draco/');
      const ktx = new KTX2Loader().setTranscoderPath('/libs/basis/').detectSupport(ctx.renderer);
      loaders = { draco, ktx };
    }
    return loaders;
  }

  function setGain() {
    // unlit photos through the HDR pipeline: undo the exposure, then follow the time of day
    const e = ctx.env.state;
    const night = e.night || 0;
    U.gpaExposure.value = e.exposure || 0.46;
    // midday: exactly the photo. Golden hour warms it a little, night dims and cools it.
    const k = 1 - 0.86 * THREE.MathUtils.smoothstep(night, 0.3, 1);
    const t = e.tint || { r: 1, g: 1, b: 1 }, m = Math.max(t.r, t.g, t.b) || 1;
    const warm = night > 0.6 ? 0.75 : night > 0.05 ? 0.3 : 0;
    gain.setRGB(k * (1 - warm + warm * (t.r / m)), k * (1 - warm + warm * (t.g / m)), k * (1 - warm + warm * (t.b / m)));
  }

  function prepare(sceneObj) {
    sceneObj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      let m = o.material;
      if (!m.isMeshBasicMaterial) { // lit by the photo itself
        const basic = new THREE.MeshBasicMaterial({ map: m.map || null });
        m.dispose();
        o.material = m = basic;
      }
      m.color.set(0xffffff);
      m.toneMapped = false;
      const tex = m.map;
      if (tex && !tex.userData.gpa) {
        // sharp at a glancing angle (the road ahead) and stable in the distance
        tex.userData.gpa = true;
        tex.anisotropy = maxAniso;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
      }
      untone(m);
      S.materials.add(m);
    });
  }

  function start(world) {
    stop(true);
    if (!allowed || !world) return;
    S.loading = true; S.failed = ''; S.models = 0; S.calibrated = 0; S.startedAt = performance.now();
    S.city = world.city;
    cache.clear();
    const [lat, lon] = world.area.center;
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
    const L = gltfLoaders();
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: L.draco, ktxLoader: L.ktx }));
    tiles.registerPlugin(new ReorientationPlugin({ lat: THREE.MathUtils.degToRad(lat), lon: THREE.MathUtils.degToRad(lon), height: 0 }));
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.errorTarget = S.errorTarget;
    // keep what is around the car in memory so nearby blocks do not drop out and reload
    tiles.lruCache.minSize = 9000; tiles.lruCache.maxSize = 12000;
    tiles.lruCache.minBytesSize = 0.8 * 2 ** 30; tiles.lruCache.maxBytesSize = 1.0 * 2 ** 30;
    tiles.setCamera(ctx.camera);
    tiles.setResolutionFromRenderer(ctx.camera, ctx.renderer);
    tiles.addEventListener('load-model', (e) => { S.models++; prepare(e.scene); });
    tiles.addEventListener('dispose-model', (e) => e.scene.traverse((o) => { if (o.isMesh) S.materials.delete(o.material); }));
    tiles.addEventListener('load-error', (e) => { if (!S.models) console.warn('[tiles] load error:', String(e.error?.message || e.error || '').slice(0, 120)); });
    tiles.addEventListener('tiles-load-end', () => { if (S.on && S.calibrated < 2) calibrate(); });
    // the plugin leaves west = +x and north = +z: half a turn makes it our east = +x, south = +z
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI;
    holder.add(tiles.group);
    holder.visible = false;
    ctx.scene.add(holder);
    S.tiles = tiles; S.holder = holder;
    setGain();
    clearTimeout(S.timer);
    S.timer = setTimeout(() => {
      if (S.loading && S.tiles === tiles) fail(S.models ? 'too slow' : 'nothing loaded in 6 seconds');
    }, LOAD_TIMEOUT);
  }

  function show() {
    // enough of the city has arrived: swap it in
    S.loading = false; S.on = true;
    clearTimeout(S.timer);
    S.holder.visible = true;
    catcher.visible = true;
    ctx.world.setCityVisible(false);
    document.body.classList.add('g3d');
    ctx.env.setHaze(600, 3400); // clear nearby, sky colored far away
    if (ctx.post.setNeutral) ctx.post.setNeutral(true);
    calibrate();
    console.info(`[tiles] Google 3D city on after ${Math.round(performance.now() - S.startedAt)} ms (${S.models} tiles)`);
    ctx.emit('tiles', true);
  }

  function fail(why) {
    console.warn(`[tiles] falling back to the block city: ${why}`);
    S.failed = why;
    stop(true);
    if (ctx.state === 'play') ctx.hud.toast('Google 3D city unavailable, showing the block city', 3500);
  }

  function stop(quiet) {
    clearTimeout(S.timer);
    if (S.tiles) {
      ctx.scene.remove(S.holder);
      S.tiles.dispose();
      S.tiles = null; S.holder = null;
    }
    S.materials.clear();
    cache.clear();
    const was = S.on;
    S.on = false; S.loading = false;
    catcher.visible = false;
    document.body.classList.remove('g3d');
    ctx.env.setHaze(null);
    if (ctx.post && ctx.post.setNeutral) ctx.post.setNeutral(false);
    if (ctx.world) ctx.world.setCityVisible(true);
    if (was) ctx.emit('tiles', false);
  }

  // ---- ground from the tiles
  function castDown(x, yTop, z, far) {
    origin.set(x, yTop, z);
    ray.set(origin, DOWN); ray.far = far;
    const h = ray.intersectObject(S.tiles.group, true);
    return h.length ? h[0].point.y : null;
  }
  // Tile ground against our terrain where the car stands. The first pass uses long rays (the
  // ellipsoid height of the area is unknown), the second short ones once sharper tiles are in.
  function calibrate() {
    const s = ctx.car.state;
    const base = terrainAt(s.x, s.z);
    const diffs = [];
    S.holder.updateMatrixWorld(true);
    for (let i = 0; i < 13; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : 2 + (i % 4) * 2.2;
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      if (ctx.world.buildingAt(x, z)) continue;
      const y = S.calibrated ? castDown(x, terrainAt(x, z) + 3, z, 9) : castDown(x, base + 900, z, 2400);
      if (y !== null) diffs.push(y - terrainAt(x, z));
    }
    if (diffs.length < 3) return;
    diffs.sort((p, q) => p - q);
    // the low end of the samples is road; the high end is tree tops and parked cars
    const d = diffs[Math.floor(diffs.length * 0.25)];
    S.holder.position.y -= d;
    S.holder.updateMatrixWorld(true);
    S.calibrated++;
    S.offset = (S.offset || 0) + d;
    cache.clear();
  }

  function tileHeight(x, z) {
    const t = terrainAt(x, z);
    if (!S.on || !S.calibrated) return t;
    const k = Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663;
    const now = performance.now();
    const c = cache.get(k);
    if (c && now - c.t < TTL) return c.y;
    if (budget <= 0) return c ? c.y : t;
    budget--;
    // lowest of five nearby rays: a parked car or a hedge in the photo mesh is not the road
    let best = null;
    for (const [dx, dz] of [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) {
      const y = castDown(x + dx, t + 2.6, z + dz, 7);
      if (y !== null && (best === null || y < best)) best = y;
    }
    const y = best === null || Math.abs(best - t) > 4 ? t : best;
    cache.set(k, { y, t: now });
    if (cache.size > 6000) { for (const [kk, v] of cache) if (now - v.t > TTL) cache.delete(kk); }
    return y;
  }

  ctx.on('city', (world) => {
    terrainAt = world.heightAt;
    world.terrainAt = terrainAt;
    world.heightAt = (x, z) => tileHeight(x, z);
    if (wanted) start(world);
  });
  ctx.on('city-unload', () => stop(true));
  ctx.on('time-of-day', () => {});

  let slow = 0, lastCredit = 0, lastGainKey = '';
  ctx.on('update', (dt) => {
    budget = RAY_BUDGET;
    if (!S.tiles) return;
    if (ctx.state !== 'tour') {
      ctx.camera.updateMatrixWorld();
      S.tiles.setResolutionFromRenderer(ctx.camera, ctx.renderer);
      S.tiles.update();
    }
    if (S.loading && S.models >= 6 && performance.now() - S.startedAt > 900) show();
    if (!S.on) return;
    const e = ctx.env.state, gk = `${(e.exposure || 0).toFixed(3)}|${(e.night || 0).toFixed(3)}`;
    if (gk !== lastGainKey) { lastGainKey = gk; setGain(); }
    const s = ctx.car.state;
    catcher.position.set(s.x, s.y + 0.05, s.z);
    catcher.material.opacity = 0.42 * (1 - THREE.MathUtils.smoothstep(e.night || 0, 0.5, 1));
    // hold 60 fps: coarser tiles when the frame rate sags, finer again when there is room
    const fps = window.__gpa.fps;
    slow += dt;
    if (slow > 1.5 && fps) {
      // sharper tiles one step at a time while the frame rate holds above 55, back off below it
      slow = 0;
      if (fps < 52 && S.errorTarget < 40) S.errorTarget += 4;
      else if (fps < 55 && S.errorTarget < 40) S.errorTarget += 1;
      else if (fps >= 57 && S.errorTarget > 6) S.errorTarget -= 2;
      S.tiles.errorTarget = S.errorTarget;
    }
    const now = performance.now();
    if (now - lastCredit > 1500) {
      lastCredit = now;
      const text = S.tiles.getAttributions().filter((a) => a.type === 'string').map((a) => a.value).join(' · ');
      credit.lastChild.textContent = text ? `Map data © ${text.replace(/^©\s*/, '')}` : 'Map data © Google';
    }
  });

  ctx.on('key', (code) => {
    // G switches between the Google 3D city and the block city (M is the map, src/bigmap.js)
    if (code !== 'KeyG' || ctx.state !== 'play' || ctx.hud.choosing) return;
    if (!allowed) { ctx.hud.toast(ctx.mock ? 'Google 3D city is off in mock mode' : 'No Google Maps key: block city only'); return; }
    wanted = !(S.on || S.loading);
    try { localStorage.setItem('gpa-city3d', wanted ? 'on' : 'off'); } catch { /* private mode */ }
    if (wanted) { start(ctx.world); ctx.hud.toast('Loading the Google 3D city'); } else { stop(); ctx.hud.toast('Block city'); }
  });

  const api = {
    state: S,
    get on() { return S.on; },
    get allowed() { return allowed; },
    info() { return { on: S.on, loading: S.loading, failed: S.failed, tiles: S.models, errorTarget: S.errorTarget, offset: S.offset || 0, calibrated: S.calibrated }; },
    setVisible(v) { if (S.holder) S.holder.visible = v && S.on; },
    // chase camera: if the photo mesh stands between the car and the camera, bring the camera
    // in front of it (the footprints' heights do not match the photo mesh closely enough)
    clearView(from, cam) {
      if (!S.on || !S.calibrated) return;
      origin.copy(from);
      view.copy(cam).sub(from);
      const dist = view.length();
      if (dist < 1) return;
      view.multiplyScalar(1 / dist);
      ray.set(origin, view); ray.far = dist + 0.6;
      const h = ray.intersectObject(S.tiles.group, true);
      if (h.length) cam.copy(from).addScaledVector(view, Math.max(2.2, h[0].distance - 0.8));
    },
  };
  window.__gpa.tiles = () => api.info();
  return api;
}
