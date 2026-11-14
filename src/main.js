// Grand Property Auto entry point: renderer, game loop and the wiring between systems.
import * as THREE from 'three';
import { loadConfig } from './data.js';
import { createWorld } from './world.js';
import { createCar } from './car.js';
import { createCamera } from './camera.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { initSystems } from './systems.js';
import { createEnv } from './env.js';
import { createPost } from './post.js';
import { pickQuality } from './quality.js';

const params = new URLSearchParams(location.search);
const config = await loadConfig();
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const quality = pickQuality(renderer, params);
console.info(`[gpa] graphics: ${quality.gpu || 'unknown'}: ${quality.label} quality`);
renderer.setPixelRatio(quality.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !quality.low;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9d3f2);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 4000);

// tiny event bus shared by every system
const handlers = new Map();
const ctx = {
  config, params, renderer, scene, camera, quality,
  state: 'loading', // loading | title | play | tour | compare
  world: null, car: null,
  on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); return ctx; },
  emit(name, ...args) { for (const fn of handlers.get(name) || []) fn(...args); },
  mock: config.mode === 'mock',
};
window.__gpa = { ready: false, fps: 0, mode: config.mode, car: { x: 0, z: 0, speed: 0 }, ctx, quality };

ctx.env = createEnv(ctx);
ctx.input = createInput(ctx);
ctx.car = createCar(ctx);
ctx.cam = createCamera(ctx);
ctx.audio = createAudio(ctx);
ctx.post = createPost(ctx);

const CITIES = config.mode === 'mock' ? ['mock'] : ['houston', 'la'];
ctx.cities = CITIES;
let loadToken = 0;
ctx.loadCity = async function loadCity(city) {
  const token = ++loadToken;
  if (!CITIES.includes(city)) city = CITIES[0];
  document.body.classList.add('loading');
  ctx.emit('city-unload');
  if (ctx.world) { ctx.world.dispose(); ctx.world = null; }
  const world = await createWorld(ctx, city);
  if (token !== loadToken) { world.dispose(); return; }
  ctx.world = world;
  ctx.city = city;
  ctx.car.setWorld(world);
  const spawn = world.findSpawn(0, 0);
  ctx.car.place(spawn.x, spawn.z, 0);
  ctx.cam.snap();
  try { localStorage.setItem('gpa-city', city); } catch { /* private mode */ }
  document.body.classList.remove('loading');
  ctx.emit('city', world);
  window.__gpa.city = city;
  window.__gpa.buildings = world.buildings.length;
  window.__gpa.listings = world.listings.length;
};

await initSystems(ctx);

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  ctx.post.resize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
});

let stored = null;
try { stored = localStorage.getItem('gpa-city'); } catch { /* ignore */ }
await ctx.loadCity(params.get('city') || stored || CITIES[0]);
ctx.emit('boot');

const timer = new THREE.Timer();
let frames = 0, fpsTime = 0, slow = 0;
const focus = new THREE.Vector3();
renderer.setAnimationLoop((t) => {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 0.05);
  const driving = ctx.state === 'play';
  if (ctx.world) {
    const inp = driving ? ctx.input.get() : { throttle: 0, steer: 0, handbrake: true, boost: false };
    if (ctx.state !== 'tour') ctx.car.update(dt, inp);
    ctx.emit('update', dt, inp);
    ctx.cam.update(dt);
    focus.set(ctx.car.state.x, ctx.car.state.y, ctx.car.state.z);
    ctx.world.update(focus, dt);
    ctx.env.update(dt, focus);
    ctx.audio.update(ctx.car, driving);
    if (!ctx.skipRender) ctx.post.render(dt);
    ctx.emit('post', dt);
  }
  const d = window.__gpa;
  d.car.x = ctx.car.state.x; d.car.z = ctx.car.state.z; d.car.speed = ctx.car.state.speed;
  d.state = ctx.state;
  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    d.fps = Math.round(frames / fpsTime);
    ctx.emit('fps', d.fps);
    // adaptive quality: drop resolution, then shadows, then bloom, when the machine can't hold 40 fps
    if (d.fps < 40 && d.ready) slow++; else slow = 0;
    if (slow >= 4) {
      slow = 0;
      if (ctx.post.setAO(false)) { /* ambient occlusion goes first */ }
      else if (renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); ctx.post.resize(window.innerWidth, window.innerHeight, 1); }
      else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; ctx.env.setShadows(false); }
      else ctx.post.setBloom(false);
    }
    frames = 0; fpsTime = 0;
  }
  if (ctx.world) d.ready = true;
});
