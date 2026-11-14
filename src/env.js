// Atmosphere shared by every city: a physically based sky with drifting clouds, the sun (or
// moon) with shadows, image based lighting captured from that sky so paint and glass reflect
// it, distance haze, stars, and three times of day (L cycles them).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const rad = THREE.MathUtils.degToRad;
const PRESETS = {
  day: {
    skyElev: 48, azim: 148, lightElev: 48, turbidity: 3.2, rayleigh: 1.1, mie: 0.004, clouds: 0.38,
    sun: 0xfff0dc, sunI: 3.1, hemiSky: 0xe4eaf4, hemiGround: 0x8a8272, hemiI: 0.95, envI: 0.06,
    fog: 0xb4c8dc, fogNear: 320, fogFar: 2100, exposure: 0.46, night: 0,
  },
  golden: {
    skyElev: 15, azim: 252, lightElev: 17, turbidity: 5, rayleigh: 3, mie: 0.0015, clouds: 0.45,
    sun: 0xffb46e, sunI: 8, hemiSky: 0xe0d6e0, hemiGround: 0x8a6a52, hemiI: 1.1, envI: 0.12,
    fog: 0xc9a288, fogNear: 300, fogFar: 2000, exposure: 0.2, night: 0.25,
  },
  night: {
    skyElev: -14, azim: 300, lightElev: 46, turbidity: 2, rayleigh: 0.6, mie: 0.002, clouds: 0.25,
    sun: 0x9db2ff, sunI: 1.0, hemiSky: 0x4a5c88, hemiGround: 0x22222c, hemiI: 1.0, envI: 0.2,
    fog: 0x0a101c, fogNear: 160, fogFar: 1300, exposure: 1.15, night: 1,
  },
};
const ORDER = ['day', 'golden', 'night'];
const NUM = ['skyElev', 'azim', 'lightElev', 'turbidity', 'rayleigh', 'mie', 'clouds', 'sunI', 'hemiI', 'envI', 'fogNear', 'fogFar', 'exposure', 'night'];
const COL = ['sun', 'hemiSky', 'hemiGround', 'fog'];

export function createEnv(ctx) {
  const { scene, renderer } = ctx;
  const low = ctx.quality.low;

  const sky = new Sky();
  sky.scale.setScalar(3000);
  sky.material.fog = false;
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  scene.add(sky);
  const U = sky.material.uniforms;

  // a second box sharing the sky material, rendered into the reflection map
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, sky.material);
  envSky.scale.setScalar(1000);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  const stars = (() => {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, y = Math.random() * 0.95 + 0.03, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 2400, y * 2400, Math.sin(a) * r * 2400], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    p.frustumCulled = false;
    p.renderOrder = -1;
    return p;
  })();
  scene.add(stars);

  scene.fog = new THREE.Fog(0xc6d8e8, 260, 1700);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.5);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(ctx.quality.shadowMap, ctx.quality.shadowMap);
  const sc = sun.shadow.camera;
  const span = ctx.quality.shadowSpan;
  sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 10; sc.far = 800;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.45;
  scene.add(hemi, sun, sun.target);

  const cur = {}, from = {}, to = {};
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  const sunDir = new THREE.Vector3(), skyDir = new THREE.Vector3();
  const state = { name: 'day', night: 0, t: 1 };
  let envDirty = true, envClock = 0, time = 0, haze = null;

  function copyPreset(dst, p) {
    for (const k of NUM) dst[k] = p[k];
    for (const k of COL) dst[k] = new THREE.Color(p[k]);
  }
  function apply() {
    U.turbidity.value = cur.turbidity; U.rayleigh.value = cur.rayleigh; U.mieCoefficient.value = cur.mie;
    U.mieDirectionalG.value = 0.82;
    if (U.cloudCoverage) { U.cloudCoverage.value = cur.clouds; U.cloudDensity.value = 0.45; U.cloudScale.value = 0.00018; U.cloudSpeed.value = 0.00004; }
    skyDir.setFromSphericalCoords(1, rad(90 - cur.skyElev), rad(cur.azim));
    U.sunPosition.value.copy(skyDir);
    sunDir.setFromSphericalCoords(1, rad(90 - cur.lightElev), rad(cur.azim));
    sun.color.copy(cur.sun); sun.intensity = cur.sunI;
    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiI;
    scene.fog.color.copy(cur.fog); scene.fog.near = haze ? haze[0] : cur.fogNear; scene.fog.far = haze ? haze[1] : cur.fogFar;
    scene.environmentIntensity = cur.envI;
    renderer.toneMappingExposure = cur.exposure;
    stars.material.opacity = Math.max(0, cur.night - 0.45) * 1.8;
    stars.visible = stars.material.opacity > 0.01;
    state.night = cur.night;
    state.exposure = cur.exposure;
    state.tint = cur.sun;
  }
  function bakeEnv() {
    const disc = U.showSunDisc ? U.showSunDisc.value : 0;
    if (U.showSunDisc) U.showSunDisc.value = 0; // the sun light already gives the highlight
    const rt = pmrem.fromScene(envScene, 0, 1, 2000);
    if (U.showSunDisc) U.showSunDisc.value = disc;
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
    envDirty = false;
  }

  function set(name, instant = false) {
    if (!PRESETS[name]) name = 'day';
    state.name = name;
    copyPreset(to, PRESETS[name]);
    if (instant || !Object.keys(cur).length) { copyPreset(cur, PRESETS[name]); state.t = 1; apply(); envDirty = true; } else { copyPreset(from, cur); for (const k of COL) from[k] = cur[k].clone(); state.t = 0; }
    ctx.emit('time-of-day', name);
  }

  function update(dt, focus) {
    time += dt;
    if (U.time) U.time.value = time * 1000;
    if (state.t < 1) {
      state.t = Math.min(1, state.t + dt / 3);
      const k = state.t * state.t * (3 - 2 * state.t);
      for (const key of NUM) cur[key] = from[key] + (to[key] - from[key]) * k;
      for (const key of COL) cur[key].copy(tmpA.copy(from[key]).lerp(tmpB.copy(to[key]), k));
      apply();
      envClock += dt;
      if (envClock > 0.4 || state.t === 1) { envClock = 0; envDirty = true; }
    }
    if (envDirty) bakeEnv();
    const c = ctx.camera.position;
    sky.position.copy(c);
    stars.position.set(c.x, 0, c.z);
    if (focus) {
      sun.position.set(focus.x + sunDir.x * 320, focus.y + sunDir.y * 320, focus.z + sunDir.z * 320);
      sun.target.position.copy(focus);
    }
  }

  let wanted = ctx.params.get('time');
  try { wanted = wanted || localStorage.getItem('gpa-time'); } catch { /* private mode */ }
  set(wanted || 'day', true);

  return {
    update, set, state, sun, sunDir,
    cycle() {
      const next = ORDER[(ORDER.indexOf(state.name) + 1) % ORDER.length];
      set(next);
      try { localStorage.setItem('gpa-time', next); } catch { /* private mode */ }
      return next;
    },
    setShadows(on) { sun.castShadow = on; },
    // the Google city wants clear air nearby and haze only in the distance
    setHaze(near, far) { haze = near == null ? null : [near, far]; apply(); },
  };
}
