// Walk mode: free first person walking inside a home.
//
// Geometry is the scan's 3D mesh. Its base color is baked per vertex from the panoramas
// (tools/build_walk.py); on top of that the real panorama photos are projected from the two
// scan points nearest the player, each through a distance cube map rendered from that scan
// point so a photo never lands on a wall that scan could not see. Far from every scan point
// the projection fades out and the base color carries the room.
//
// Movement: a 1.6 m eye height capsule with acceleration, ray cast collisions against the
// mesh (three-mesh-bvh), sliding along walls, gravity, steps up to 0.35 m, a light head bob.
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { buildGraph, createRider, components } from './rails.js';

const EYE = 1.6, RADIUS = 0.3, STEP_UP = 0.35;
const WALK = 2.4, RUN = 4.3, ACCEL = 14, BRAKE = 18;
const TIER_PX = { '': 1024, '2k': 2048, '4k': 4096 };

// model space is z up; the game is y up
const toWorld = (p, out = new THREE.Vector3()) => out.set(p[0], p[2], -p[1]);

const FRAG = `
  uniform sampler2D atlasA; uniform sampler2D atlasB;
  uniform vec3 posA; uniform vec3 posB; uniform mat3 rotA; uniform mat3 rotB;
  uniform float mixB; uniform float camA; uniform float camB; uniform float useBase; uniform float solo;
  uniform samplerCube depthA; uniform samplerCube depthB; uniform vec3 wposA; uniform vec3 wposB; uniform float useDepth;
  varying vec3 vModel; varying vec3 vWorld; varying vec3 vBase;
  vec3 pano(sampler2D atlas, vec3 pos, mat3 rot) {
    vec3 m = rot * (vModel - pos);
    vec3 s = vec3(-m.y, m.z, m.x);          // sky box frame: x right, y up, z forward
    vec3 a = abs(s); float face; vec2 uv;
    if (a.y >= a.x && a.y >= a.z) { if (s.y > 0.0) { face = 0.0; uv = vec2(s.x, s.z) / a.y; } else { face = 5.0; uv = vec2(s.x, -s.z) / a.y; } }
    else if (a.z >= a.x) { if (s.z > 0.0) { face = 1.0; uv = vec2(s.x, -s.y) / a.z; } else { face = 3.0; uv = vec2(-s.x, -s.y) / a.z; } }
    else { if (s.x > 0.0) { face = 2.0; uv = vec2(-s.z, -s.y) / a.x; } else { face = 4.0; uv = vec2(s.z, -s.y) / a.x; } }
    uv = clamp(uv * 0.5 + 0.5, 0.0012, 0.9988);
    float col = mod(face, 3.0), row = floor(face / 3.0);
    return texture2D(atlas, vec2((col + uv.x) / 3.0, 1.0 - (row + uv.y) / 2.0)).rgb;
  }
  // 1 when this surface point was in sight of the scan point, 0 when something stood between;
  // it also lets go of surfaces a long way from the scan, where the photo is stretched thin
  float seen(samplerCube depth, vec3 wpos) {
    vec3 d = vWorld - wpos;
    float dist = length(d);
    float stored = textureCube(depth, d).r;
    float vis = 1.0 - smoothstep(0.1 + dist * 0.035, 0.3 + dist * 0.07, dist - stored);
    return vis * (1.0 - smoothstep(11.0, 16.0, dist));
  }
  void main() {
    vec3 ca = pano(atlasA, posA, rotA);
    vec3 cb = pano(atlasB, posB, rotB);
    float va = 1.0, vb = 1.0;
    if (useDepth > 0.5) { va = seen(depthA, wposA); vb = seen(depthB, wposB); }
    // camA and camB fade a scan out as the player walks more than about 4 m away from it
    // on rails only the nearest scan is projected (solo); the second one shows just while
    // the view crosses over from one scan to the next
    float wa = va * camA * (1.0 - mixB), wb = vb * camB * max(mixB, 0.06 * (1.0 - solo));
    float cover = clamp(max(va * camA, vb * camB * mix(1.0, step(0.001, mixB), solo)), 0.0, 1.0);
    vec3 proj = (ca * wa + cb * wb) / max(wa + wb, 0.0001);
    vec3 base = mix(ca * 0.82, vBase, useBase);   // no baked colors: fall back to the nearer photo
    gl_FragColor = vec4(mix(base, proj, cover), 1.0);
    #include <colorspace_fragment>
  }`;
const VERT = `
  varying vec3 vModel; varying vec3 vWorld; varying vec3 vBase;
  void main() {
    vWorld = position;
    vModel = vec3(position.x, -position.z, position.y);
    #ifdef USE_COLOR
      vBase = pow(color.rgb, vec3(2.2));
    #else
      vBase = vec3(0.35);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export function createWalk(ctx, hooks = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1014);
  const cam = new THREE.PerspectiveCamera(72, 1, 0.05, 300);
  cam.rotation.order = 'YXZ';
  const blank = new THREE.DataTexture(new Uint8Array([20, 22, 26, 255]), 1, 1);
  blank.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, vertexShader: VERT, fragmentShader: FRAG, vertexColors: true,
    uniforms: {
      atlasA: { value: blank }, atlasB: { value: blank }, posA: { value: new THREE.Vector3() }, posB: { value: new THREE.Vector3() },
      rotA: { value: new THREE.Matrix3() }, rotB: { value: new THREE.Matrix3() }, mixB: { value: 0 }, camA: { value: 1 }, camB: { value: 1 }, useBase: { value: 0 }, solo: { value: 0 },
      depthA: { value: null }, depthB: { value: null }, wposA: { value: new THREE.Vector3() }, wposB: { value: new THREE.Vector3() }, useDepth: { value: 0 },
    },
  });
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const W = {
    ready: false, mesh: null, meta: null, base: '', panos: [], hiTier: '',
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, a: null, b: null, glide: null, losClock: 0, near: null,
    grounded: true, onFloor: true, phase: 0, bob: 0, speed: 0, pad: null, hi: null, hiWait: 0, blocked: 0,
    graph: null, rider: null, railOn: false, touring: false, home: null,
  };
  const atlases = new Map(); // "<faces>|<tier>" -> { tex, promise, used, failed, depth }
  let useClock = 0;

  // distance from a scan point to the first surface in every direction
  const distMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { center: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 center; varying vec3 vW; void main(){ gl_FragColor = vec4(length(vW - center), 0.0, 0.0, 1.0); }',
  });
  const emptyCube = new THREE.WebGLCubeRenderTarget(4, { type: THREE.HalfFloatType });
  mat.uniforms.depthA.value = emptyCube.texture; mat.uniforms.depthB.value = emptyCube.texture;
  const depths = new Map(); // scan id -> cube target (cheap, kept for the whole visit)
  function depthFor(entry) {
    let rt = depths.get(entry.p.id);
    if (rt) return rt;
    rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const cc = new THREE.CubeCamera(0.03, 200, rt);
    cc.position.copy(entry.w);
    distMat.uniforms.center.value.copy(entry.w);
    const bg = scene.background;
    scene.background = new THREE.Color(900, 900, 900);
    scene.overrideMaterial = distMat;
    scene.add(cc);
    cc.update(ctx.renderer, scene);
    scene.remove(cc);
    scene.overrideMaterial = null;
    scene.background = bg;
    depths.set(entry.p.id, rt);
    return rt;
  }

  // ---- panoramas: six faces packed into one texture, 1K at once, sharper for where you stand
  function loadAtlas(p, tier = '') {
    const key = `${p.faces}|${tier}`;
    let e = atlases.get(key);
    if (e) { e.used = ++useClock; return e; }
    e = { tex: null, used: ++useClock, failed: false, tier };
    atlases.set(key, e);
    const px = TIER_PX[tier];
    const bitmaps = [0, 1, 2, 3, 4, 5].map(async (k) => {
      const res = await fetch(`${W.base}${p.faces}${tier ? '_' + tier : ''}_${k}.jpg`);
      if (!res.ok || (res.headers.get('content-type') || '').includes('html')) throw new Error('face');
      return createImageBitmap(await res.blob());
    });
    e.promise = Promise.all(bitmaps).then((list) => {
      const c = document.createElement('canvas');
      c.width = px * 3; c.height = px * 2;
      const g = c.getContext('2d');
      list.forEach((im, k) => { g.drawImage(im, (k % 3) * px, Math.floor(k / 3) * px, px, px); im.close && im.close(); });
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
      e.tex = t;
      // memory: six 1K panoramas, and one sharp one, at a time
      const live = [...atlases.entries()].filter(([, v]) => v.tex && v !== e && (v.tier === '') === (tier === ''));
      const cap = tier === '' ? 6 : 1;
      live.sort((x, y) => x[1].used - y[1].used);
      while (live.length >= cap) { const [k0, v0] = live.shift(); v0.tex.dispose(); atlases.delete(k0); }
      return e;
    }).catch(() => { e.failed = true; return e; });
    return e;
  }
  const loTex = (o) => { const e = atlases.get(`${o.p.faces}|`); return e && e.tex ? e : null; };
  const bestTex = (o) => { const h = W.hiTier && atlases.get(`${o.p.faces}|${W.hiTier}`); return h && h.tex ? h : loTex(o); };

  function hit(origin, dir, far) {
    ray.set(origin, dir); ray.far = far;
    const h = ray.intersectObject(W.mesh, false);
    return h.length ? h[0] : null;
  }
  const DOWN = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  function floorUnder(x, feetY, z, reach = 4) {
    const h = hit(tmp.set(x, feetY + STEP_UP + 0.05, z), DOWN, reach);
    return h ? h.point.y : null;
  }

  async function load(base, meta) {
    stop();
    W.base = base; W.meta = meta;
    const [buf, cols] = await Promise.all([
      fetch(base + meta.mesh).then((r) => r.arrayBuffer()),
      meta.colors ? fetch(base + meta.colors).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null) : null,
    ]);
    const [nv, ni] = new Uint32Array(buf, 0, 2);
    const src = new Float32Array(buf, 8, nv * 3);
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { pos[i * 3] = src[i * 3]; pos[i * 3 + 1] = src[i * 3 + 2]; pos[i * 3 + 2] = -src[i * 3 + 1]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const hasBase = !!cols && cols.byteLength === nv * 3;
    // every mesh carries a color attribute so one shader serves both; gray when nothing was baked
    geo.setAttribute('color', new THREE.BufferAttribute(hasBase ? new Uint8Array(cols) : new Uint8Array(nv * 3).fill(90), 3, true));
    mat.uniforms.useBase.value = hasBase ? 1 : 0;
    // gaps in the scan (open garage doors, windows nobody scanned through) show the backdrop:
    // make it the home's average wall color instead of black
    if (hasBase) {
      const c8 = new Uint8Array(cols);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < c8.length; i += 3 * 16) { r += c8[i]; g += c8[i + 1]; b += c8[i + 2]; n++; }
      scene.background = new THREE.Color().setRGB((r / n / 255) * 0.8, (g / n / 255) * 0.8, (b / n / 255) * 0.8, THREE.SRGBColorSpace);
    } else scene.background = new THREE.Color(0x0d1014);
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.slice(8 + nv * 12, 8 + nv * 12 + ni * 4)), 1));
    geo.boundsTree = new MeshBVH(geo);
    geo.computeBoundingBox();
    W.mesh = new THREE.Mesh(geo, mat);
    W.mesh.raycast = acceleratedRaycast;
    scene.add(W.mesh);
    W.panos = meta.panos.map((p) => ({
      p, w: toWorld(p.p),
      rot: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]).invert())),
    }));
    // sharper sky boxes where they were downloaded: 2K by default; 4K only when asked for or
    // on a discrete GPU, because a 4K panorama is about 400 MB of texture
    const tiers = meta.tiers || [];
    const big = ctx.params.has('walk4k') || !/intel|radeon\(tm\) graphics|780m|680m|iris|uhd|apple/i.test(ctx.quality.gpu || '');
    // the rails: scan positions joined where the scan data says they are neighbors. Only some
    // of a home's scans are on disk, so pairs within 9 m on the same level with a clear line
    // of sight through the mesh are joined too (a clear line cannot cross a wall).
    const extra = new Map(W.panos.map((o) => [o.p.id, new Set(o.p.n || [])]));
    for (let i = 0; i < W.panos.length; i++) for (let j = i + 1; j < W.panos.length; j++) {
      const a = W.panos[i], b = W.panos[j], d = a.w.distanceTo(b.w);
      if (d > 9 || d < 0.2 || Math.abs(a.w.y - b.w.y) > 0.5) continue;
      tmp2.copy(b.w).sub(a.w).normalize();
      if (!hit(a.w, tmp2, d - 0.1)) { extra.get(a.p.id).add(b.p.id); extra.get(b.p.id).add(a.p.id); }
    }
    W.graph = buildGraph(W.panos.map((o) => ({ id: o.p.id, pos: o.w, neighbors: [...extra.get(o.p.id)], floor: o.p.floor })));
    W.hiTier = ctx.quality.low ? '' : tiers.includes('4k') && big && ctx.renderer.capabilities.maxTextureSize >= 12288 ? '4k' : tiers.includes('2k') ? '2k' : '';
    W.ready = true;
  }

  function placeAt(entry, faceInward = true) {
    const w = entry.w;
    const fl = floorUnder(w.x, w.y - 1.3, w.z);
    W.pos.set(w.x, (fl ?? w.y - 1.45) + EYE, w.z);
    W.vel.set(0, 0, 0);
    W.glide = null;
    if (faceInward && W.panos.length > 1) {
      const c = new THREE.Vector3();
      for (const o of W.panos) if (o !== entry) c.add(o.w);
      c.multiplyScalar(1 / (W.panos.length - 1)).sub(w);
      if (Math.hypot(c.x, c.z) > 0.3) W.yaw = Math.atan2(-c.x, -c.z);
    }
  }

  async function start(startPano) {
    if (!W.ready) return false;
    const entry = W.panos.find((o) => o.p === startPano) || W.panos[0];
    W.a = entry; W.b = null; W.pitch = 0;
    const e = await loadAtlas(entry.p).promise;
    if (e.failed) return false;
    placeAt(entry);
    // rails by default: start on the largest joined set of scan positions
    const main = new Set(components(W.graph)[0] || []);
    const startId = main.has(entry.p.id) ? entry.p.id : [...main][0];
    W.rider = main.size >= 2 ? createRider(W.graph, startId) : null;
    W.railOn = !!W.rider && !ctx.params.has('freewalk');
    if (W.railOn) { W.rider.faceHeading(W.yaw, 0); W.pos.copy(W.rider.state.pos); }
    mat.uniforms.solo.value = W.railOn ? 1 : 0;
    pickPanos(true);
    return true;
  }

  // the two scan points to project from: nearest to the eye, same floor and in sight preferred
  function pickPanos(force) {
    if (W.railOn && W.rider) {
      // on rails: the scan position the rider is nearest to, alone
      const R = W.rider.state;
      const o = W.panos.find((x) => x.p.id === (R.near || R.node));
      if (!o) return;
      loadAtlas(o.p);
      const ahead = R.rail.route[Math.min(R.rail.route.length - 1, R.rail.nodeNear(R.s) + 1)];
      const nx = W.panos.find((x) => x.p.id === ahead);
      if (nx) loadAtlas(nx.p);
      if (loTex(o) && W.a !== o) { W.b = W.a; W.a = o; }
      W.wantMix = 0;
      if (W.near !== W.a.p) { W.near = W.a.p; W.hiWait = 0; hooks.onPano && hooks.onPano(W.a.p); }
      return;
    }
    W.losClock++;
    if (!force && W.losClock % 5) return;
    const eye = W.pos;
    const ranked = [];
    for (const o of W.panos) {
      let d = o.w.distanceTo(eye);
      if (Math.abs(o.w.y - eye.y) > 1.3) d += 30;
      else if (d > 0.4) {
        tmp2.copy(o.w).sub(eye).normalize();
        if (hit(eye, tmp2, d - 0.15)) d += 4; // behind a wall: only if nothing better
      }
      ranked.push({ o, d });
    }
    ranked.sort((x, y) => x.d - y.d);
    ranked.slice(0, 3).forEach((r) => loadAtlas(r.o.p));
    const have = ranked.filter((r) => loTex(r.o));
    if (!have.length) return;
    const A = have[0], B = have[1];
    W.a = A.o; W.b = B ? B.o : null;
    W.wantMix = B ? THREE.MathUtils.smoothstep(A.d / (A.d + B.d), 0.36, 0.5) * 0.5 : 0;
    if (W.near !== A.o.p) { W.near = A.o.p; W.hiWait = 0; hooks.onPano && hooks.onPano(A.o.p); }
  }

  function applyUniforms(dt) {
    const u = mat.uniforms;
    const ea = W.a && bestTex(W.a), eb = W.b && bestTex(W.b);
    if (ea) {
      u.atlasA.value = ea.tex; u.posA.value.set(W.a.p.p[0], W.a.p.p[1], W.a.p.p[2]); u.rotA.value.copy(W.a.rot);
      u.depthA.value = depthFor(W.a).texture; u.wposA.value.copy(W.a.w);
    }
    if (eb) {
      u.atlasB.value = eb.tex; u.posB.value.set(W.b.p.p[0], W.b.p.p[1], W.b.p.p[2]); u.rotB.value.copy(W.b.rot);
      u.depthB.value = depthFor(W.b).texture; u.wposB.value.copy(W.b.w);
    }
    u.useDepth.value = ea && eb ? 1 : 0;
    const want = eb ? (W.wantMix || 0) : 0;
    // when the pair changes the blend restarts from the side that stayed
    if (W.lastA !== W.a || W.lastB !== W.b) {
      if (W.railOn && W.lastA === W.b) u.mixB.value = 1; // cross over from the scan just left
      else if (W.lastA === W.b && W.lastB === W.a) u.mixB.value = 1 - u.mixB.value;
      else if (W.lastB === W.a) u.mixB.value = Math.max(0, 1 - u.mixB.value - 0.5);
      else if (W.lastA !== W.a) u.mixB.value = want;
      W.lastA = W.a; W.lastB = W.b;
    }
    u.mixB.value += (want - u.mixB.value) * Math.min(1, dt * 6);
    // more than about 4 m from a scan point its photo lets go and the mesh's own color shows
    const fade = (o) => (o ? 1 - THREE.MathUtils.smoothstep(Math.hypot(o.w.x - W.pos.x, o.w.z - W.pos.z), 4, 6.2) : 0);
    const keep = u.useBase.value > 0.5 ? 0 : 1; // without baked colors there is nothing to fade to
    u.camA.value += (Math.max(keep, fade(W.a)) - u.camA.value) * Math.min(1, dt * 5);
    u.camB.value += (Math.max(keep, fade(W.b)) - u.camB.value) * Math.min(1, dt * 5);
    // the sharp version of where you stand, once you have been near it for a moment
    if (W.hiTier && W.a) {
      W.hiWait += dt;
      if (W.hiWait > 0.5) loadAtlas(W.a.p, W.hiTier);
    }
  }

  function move(dt) {
    const k = ctx.input.keys;
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    W.yaw += turn * dt * 1.9;
    const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    W.pitch = THREE.MathUtils.clamp(W.pitch + tilt * dt, -1.25, 1.25);
    if (W.railOn && W.rider) {
      const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + ((W.pad && W.pad.y) || 0);
      W.rider.state.yawOff += turn * dt * 1.9;
      W.rider.state.pitch = THREE.MathUtils.clamp(W.rider.state.pitch + tilt * dt, -1.25, 1.25);
      const R = W.rider.update(dt, { move: f, run: k.has('ShiftLeft') || k.has('ShiftRight'), branch: (k.has('KeyA') ? -1 : 0) + (k.has('KeyD') ? 1 : 0) });
      if (R.done) { R.done = false; W.touring = false; W.rider.stopTour(); W.rider.resetAt(W.home || R.rail.route[0]); hooks.onTourEnd && hooks.onTourEnd(); }
      W.pos.copy(W.rider.state.pos);
      W.yaw = W.rider.heading; W.pitch = W.rider.state.pitch;
      W.speed = Math.abs(W.rider.state.v);
      W.vel.set(0, 0, 0); W.grounded = true; W.onFloor = true; W.glide = null;
      return;
    }
    if (W.glide) {
      const g = W.glide;
      g.t = Math.min(1, g.t + dt / g.dur);
      W.pos.lerpVectors(g.from, g.to, g.t * g.t * (3 - 2 * g.t));
      W.vel.set(0, 0, 0);
      W.speed = g.speed;
      if (g.t >= 1) W.glide = null;
      return;
    }
    // what the player asks for
    let f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + ((W.pad && W.pad.y) || 0);
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + ((W.pad && W.pad.x) || 0);
    const wl = Math.hypot(f, s);
    if (wl > 1) { f /= wl; s /= wl; }
    const top = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
    const wx = (-Math.sin(W.yaw) * f + Math.cos(W.yaw) * s) * top, wz = (-Math.cos(W.yaw) * f - Math.sin(W.yaw) * s) * top;
    // ease toward it: quick to start, a little quicker to stop
    const ex = wx - W.vel.x, ez = wz - W.vel.z, el = Math.hypot(ex, ez);
    const rate = (wl > 0.01 ? ACCEL : BRAKE) * dt;
    if (el <= rate) { W.vel.x = wx; W.vel.z = wz; } else { W.vel.x += (ex / el) * rate; W.vel.z += (ez / el) * rate; }

    let feet = W.pos.y - EYE;
    let mx = W.vel.x * dt, mz = W.vel.z * dt;
    W.blocked = 0;
    // the capsule: rays at shin, hip and head height, straight ahead and to both sides of the
    // motion; whatever is hit first stops us, and what is left of the motion slides along it
    for (let pass = 0; pass < 3; pass++) {
      const l = Math.hypot(mx, mz);
      if (l < 1e-5) break;
      const dx = mx / l, dz = mz / l;
      let first = null, room = Infinity;
      for (const ang of [0, 0.7, -0.7]) {
        const cs = Math.cos(ang), sn = Math.sin(ang);
        tmp2.set(dx * cs - dz * sn, 0, dx * sn + dz * cs);
        const reach = ang ? RADIUS * 0.9 : RADIUS;
        for (const hgt of [STEP_UP + 0.08, 0.95, 1.5]) {
          const h = hit(tmp.set(W.pos.x, feet + hgt, W.pos.z), tmp2, l + reach);
          if (h && h.distance - reach < room) { room = h.distance - reach; first = h; }
        }
      }
      if (!first) { W.pos.x += mx; W.pos.z += mz; break; }
      W.blocked++;
      const go = Math.max(0, Math.min(l, room) - 0.01);
      W.pos.x += dx * go; W.pos.z += dz * go;
      nrm.copy(first.face.normal); nrm.y = 0;
      if (nrm.lengthSq() < 1e-6) { mx = mz = 0; W.vel.x = W.vel.z = 0; break; }
      nrm.normalize();
      if (nrm.x * dx + nrm.z * dz > 0) nrm.negate(); // face the walker
      const rest = l - go;
      let rx = dx * rest, rz = dz * rest;
      const dn = rx * nrm.x + rz * nrm.z;
      rx -= dn * nrm.x; rz -= dn * nrm.z;
      mx = rx; mz = rz;
      const vn = W.vel.x * nrm.x + W.vel.z * nrm.z;
      if (vn < 0) { W.vel.x -= vn * nrm.x; W.vel.z -= vn * nrm.z; }
    }

    // floor: step up to 0.35 m, ease down a stair, fall under gravity past that
    const fl = floorUnder(W.pos.x, feet, W.pos.z);
    W.onFloor = fl !== null;
    if (fl === null) { W.vel.y = 0; } else if (fl >= feet - STEP_UP) {
      feet += (fl - feet) * Math.min(1, dt * 13);
      W.vel.y = 0; W.grounded = true;
    } else {
      W.vel.y -= 9.8 * dt;
      feet += W.vel.y * dt;
      W.grounded = false;
      if (feet <= fl) { feet = fl; W.vel.y = 0; W.grounded = true; }
    }
    W.pos.y = feet + EYE;
    W.speed = Math.hypot(W.vel.x, W.vel.z);
  }

  function bobAndSteps(dt) {
    const sp = W.speed;
    const before = Math.floor(W.phase);
    if (sp > 0.5 && W.grounded) W.phase += dt * (1.1 + sp * 0.36);
    if (Math.floor(W.phase) !== before && hooks.onStep) hooks.onStep(sp);
    const want = sp > 0.5 && !W.railOn ? Math.sin(W.phase * Math.PI * 2) * 0.026 * Math.min(1, sp / WALK) : 0; // rails glide
    W.bob += (want - W.bob) * Math.min(1, dt * 12);
  }

  function render(dt) {
    if (!W.ready) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    move(dt);
    bobAndSteps(dt);
    pickPanos(false);
    applyUniforms(dt);
    cam.position.set(W.pos.x, W.pos.y + W.bob, W.pos.z);
    cam.rotation.set(W.pitch, W.yaw, 0);
    ctx.renderer.render(scene, cam);
  }

  function goTo(pano) {
    const entry = W.panos.find((o) => o.p === pano);
    if (!entry || W.glide) return;
    if (W.railOn && W.rider) { if (W.rider.resetAt(entry.p.id)) { loadAtlas(entry.p); W.pos.copy(W.rider.state.pos); } return; }
    const fl = floorUnder(entry.w.x, entry.w.y - 1.3, entry.w.z);
    const to = new THREE.Vector3(entry.w.x, (fl ?? entry.w.y - 1.45) + EYE, entry.w.z);
    const d = to.distanceTo(W.pos);
    loadAtlas(entry.p);
    const dur = THREE.MathUtils.clamp(d / 3.2, 0.5, 2.2);
    W.glide = { from: W.pos.clone(), to, t: 0, dur, speed: d / dur };
    const dx = to.x - W.pos.x, dz = to.z - W.pos.z;
    if (Math.hypot(dx, dz) > 0.5) W.yaw = Math.atan2(-dx, -dz);
  }
  // "walk on": glide to the scan point most in front of us (demo mode, phone button)
  function forward() {
    if (W.railOn) return false; // on rails W itself walks on
    let best = null, bs = 0.2;
    for (const o of W.panos) {
      const dx = o.w.x - W.pos.x, dz = o.w.z - W.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8 || d > 9 || Math.abs(o.w.y - W.pos.y) > 2.5) continue;
      const score = (dx * -Math.sin(W.yaw) + dz * -Math.cos(W.yaw)) / d - d * 0.03;
      if (score > bs) { bs = score; best = o; }
    }
    if (best) goTo(best.p);
    return !!best;
  }

  function stop() {
    if (W.mesh) { scene.remove(W.mesh); W.mesh.geometry.dispose(); W.mesh = null; }
    for (const e of atlases.values()) if (e.tex) e.tex.dispose();
    atlases.clear();
    for (const rt of depths.values()) rt.dispose();
    depths.clear();
    const u = mat.uniforms;
    u.atlasA.value = blank; u.atlasB.value = blank;
    u.depthA.value = emptyCube.texture; u.depthB.value = emptyCube.texture; u.useDepth.value = 0;
    W.ready = false; W.a = W.b = W.lastA = W.lastB = null; W.near = null; W.glide = null; W.pad = null;
    W.vel.set(0, 0, 0); W.phase = 0; W.bob = 0; W.speed = 0;
    W.rider = null; W.graph = null; W.railOn = false; W.touring = false;
  }

  return {
    load, start, render, stop, goTo, forward, state: W,
    look(dx, dy = 0) {
      if (W.railOn && W.rider) W.rider.look(dx, dy);
      else { W.yaw += dx; W.pitch = THREE.MathUtils.clamp(W.pitch + dy, -1.25, 1.25); }
    },
    // rails on or off (off = free walking with collisions)
    toggleRail() {
      if (!W.rider) return false;
      W.railOn = !W.railOn;
      mat.uniforms.solo.value = W.railOn ? 1 : 0;
      if (W.railOn) {
        // step back onto the nearest scan position
        let best = null, bd = Infinity;
        for (const o of W.panos) { const d = o.w.distanceTo(W.pos); if (d < bd && W.graph.get(o.p.id).links.size) { bd = d; best = o; } }
        if (best) { W.rider.resetAt(best.p.id); W.rider.faceHeading(W.yaw, W.pitch); }
      } else { const fl = floorUnder(W.pos.x, W.pos.y - EYE, W.pos.z); if (fl !== null) W.pos.y = fl + EYE; }
      return W.railOn;
    },
    get onRails() { return W.railOn; },
    // glide the whole route in about `seconds`, then stand at the start again
    tour(seconds = 45) {
      if (!W.rider) return 0;
      if (W.touring) { W.touring = false; W.rider.stopTour(); return 0; }
      if (!W.railOn) this.toggleRail();
      W.home = W.rider.state.node || W.rider.state.near;
      W.touring = true;
      return W.rider.startTour(seconds);
    },
    setPad(x, y) { W.pad = x || y ? { x, y } : null; },
    debugPlace(entry, yaw) { placeAt(entry, false); W.yaw = yaw; W.pitch = 0; pickPanos(true); },
    get ready() { return W.ready; },
    info() {
      const bb = W.mesh ? W.mesh.geometry.boundingBox : null;
      const inside = !!bb && W.pos.x > bb.min.x && W.pos.x < bb.max.x && W.pos.z > bb.min.z && W.pos.z < bb.max.z && W.pos.y > bb.min.y && W.pos.y < bb.max.y + 0.5;
      const u = mat.uniforms;
      return {
        x: W.pos.x, y: W.pos.y, z: W.pos.z, yaw: W.yaw, speed: W.speed, a: W.a?.p.id, b: W.b?.p.id, onFloor: W.onFloor, inside,
        rail: W.railOn && W.rider ? W.rider.info() : null, touring: W.touring,
        base: u.useBase.value > 0.5, hiTier: W.hiTier, sharp: !!(W.a && W.hiTier && atlases.get(`${W.a.p.faces}|${W.hiTier}`)?.tex), camA: +u.camA.value.toFixed(2),
      };
    },
  };
}
