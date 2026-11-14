// Free walking inside a home. The scan's 3D mesh gives the walls, floors and stairs; the real
// panorama photos are projected onto it from the two scan points nearest the player and
// blended, so it looks like the photo tour but you move with WASD wherever you like.
// Collisions and floor following use ray casts against the mesh (three-mesh-bvh).
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

const EYE = 1.55, RADIUS = 0.4, STEP_UP = 0.55;
const ATLAS_FACE = 1024;

// model space is z up; the game is y up
const toWorld = (p, out = new THREE.Vector3()) => out.set(p[0], p[2], -p[1]);

const FRAG = `
  uniform sampler2D atlasA; uniform sampler2D atlasB;
  uniform vec3 posA; uniform vec3 posB; uniform mat3 rotA; uniform mat3 rotB;
  uniform float mixB; uniform float fade;
  uniform samplerCube depthA; uniform samplerCube depthB; uniform vec3 wposA; uniform vec3 wposB; uniform float useDepth;
  varying vec3 vModel; varying vec3 vNormalW; varying vec3 vWorld;
  // 1 when this surface point was in sight of the scan point, 0 when something stood between
  float seen(samplerCube depth, vec3 wpos) {
    vec3 d = vWorld - wpos;
    float dist = length(d);
    float stored = textureCube(depth, d).r;
    return 1.0 - smoothstep(0.1 + dist * 0.035, 0.3 + dist * 0.07, dist - stored);
  }
  vec3 pano(sampler2D atlas, vec3 pos, mat3 rot) {
    vec3 m = rot * (vModel - pos);
    vec3 s = vec3(-m.y, m.z, m.x);          // skybox frame: x right, y up, z forward
    vec3 a = abs(s); float face; vec2 uv;
    if (a.y >= a.x && a.y >= a.z) { if (s.y > 0.0) { face = 0.0; uv = vec2(s.x, s.z) / a.y; } else { face = 5.0; uv = vec2(s.x, -s.z) / a.y; } }
    else if (a.z >= a.x) { if (s.z > 0.0) { face = 1.0; uv = vec2(s.x, -s.y) / a.z; } else { face = 3.0; uv = vec2(-s.x, -s.y) / a.z; } }
    else { if (s.x > 0.0) { face = 2.0; uv = vec2(-s.z, -s.y) / a.x; } else { face = 4.0; uv = vec2(s.z, -s.y) / a.x; } }
    uv = clamp(uv * 0.5 + 0.5, 0.0015, 0.9985);
    float col = mod(face, 3.0), row = floor(face / 3.0);
    return texture2D(atlas, vec2((col + uv.x) / 3.0, 1.0 - (row + uv.y) / 2.0)).rgb;
  }
  void main() {
    vec3 ca = pano(atlasA, posA, rotA);
    vec3 cb = pano(atlasB, posB, rotB);
    float wa = 1.0 - mixB, wb = mixB;
    float shade = 1.0;
    if (useDepth > 0.5) {
      float va = seen(depthA, wposA), vb = seen(depthB, wposB);
      wa = va * (1.0 - mixB); wb = vb * max(mixB, 0.06);
      // seen by neither: keep the nearer photo but let it fall back a little
      if (wa + wb < 0.02) { wa = 1.0; wb = 0.0; shade = 0.82; }
    }
    vec3 c = (ca * wa + cb * wb) / (wa + wb);
    gl_FragColor = vec4(c * fade * shade, 1.0);
    #include <colorspace_fragment>
  }`;
const VERT = `
  varying vec3 vModel; varying vec3 vNormalW; varying vec3 vWorld;
  void main() {
    vWorld = position;
    vModel = vec3(position.x, -position.z, position.y);
    vNormalW = normal;
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
    side: THREE.DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      atlasA: { value: blank }, atlasB: { value: blank }, posA: { value: new THREE.Vector3() }, posB: { value: new THREE.Vector3() },
      rotA: { value: new THREE.Matrix3() }, rotB: { value: new THREE.Matrix3() }, mixB: { value: 0 }, fade: { value: 1 },
      depthA: { value: null }, depthB: { value: null }, wposA: { value: new THREE.Vector3() }, wposB: { value: new THREE.Vector3() }, useDepth: { value: 0 },
    },
  });
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const W = {
    ready: false, mesh: null, meta: null, base: '', panos: [], empty: false,
    pos: new THREE.Vector3(), yaw: 0, pitch: 0, a: null, b: null, glide: null, losClock: 0, near: null,
  };
  const atlases = new Map(); // key -> { tex, promise, used }
  let useClock = 0;

  // distance from a scan point to the first surface in every direction
  const distMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { center: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 center; varying vec3 vW; void main(){ gl_FragColor = vec4(length(vW - center), 0.0, 0.0, 1.0); }',
  });
  const emptyCube = new THREE.WebGLCubeRenderTarget(4, { type: THREE.HalfFloatType });
  mat.uniforms.depthA.value = emptyCube.texture; mat.uniforms.depthB.value = emptyCube.texture;
  function bakeDepth(center) {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const cc = new THREE.CubeCamera(0.03, 200, rt);
    cc.position.copy(center);
    distMat.uniforms.center.value.copy(center);
    const bg = scene.background;
    scene.background = new THREE.Color(900, 900, 900);
    scene.overrideMaterial = distMat;
    scene.add(cc);
    cc.update(ctx.renderer, scene);
    scene.remove(cc);
    scene.overrideMaterial = null;
    scene.background = bg;
    return rt;
  }

  function atlasKey(p) { return W.empty && p.empty ? p.empty : p.faces; }
  function loadAtlas(p) {
    const key = atlasKey(p);
    let e = atlases.get(key);
    if (e) { e.used = ++useClock; return e; }
    e = { tex: null, used: ++useClock, failed: false };
    atlases.set(key, e);
    const imgs = [0, 1, 2, 3, 4, 5].map((k) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = rej;
      im.src = `${W.base}${key}_${k}.jpg`;
    }));
    e.promise = Promise.all(imgs).then((list) => {
      const c = document.createElement('canvas');
      c.width = ATLAS_FACE * 3; c.height = ATLAS_FACE * 2;
      const g = c.getContext('2d');
      list.forEach((im, k) => g.drawImage(im, (k % 3) * ATLAS_FACE, Math.floor(k / 3) * ATLAS_FACE, ATLAS_FACE, ATLAS_FACE));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
      e.tex = t;
      // keep at most six panoramas on the GPU
      if (atlases.size > 6) {
        const old = [...atlases.entries()].filter(([, v]) => v.tex && v !== e).sort((x, y) => x[1].used - y[1].used)[0];
        if (old) { old[1].tex.dispose(); if (old[1].depth) old[1].depth.dispose(); atlases.delete(old[0]); }
      }
      return e;
    }).catch(() => { e.failed = true; return e; });
    return e;
  }

  function hit(origin, dir, far) {
    ray.set(origin, dir); ray.far = far;
    const h = ray.intersectObject(W.mesh, false);
    return h.length ? h[0] : null;
  }
  const DOWN = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  function floorUnder(x, feetY, z) {
    const h = hit(tmp.set(x, feetY + STEP_UP + 0.15, z), DOWN, 4);
    return h ? h.point.y : null;
  }

  async function load(base, meta) {
    stop();
    W.base = base; W.meta = meta;
    const buf = await (await fetch(base + meta.mesh)).arrayBuffer();
    const [nv, ni] = new Uint32Array(buf, 0, 2);
    const src = new Float32Array(buf, 8, nv * 3);
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { pos[i * 3] = src[i * 3]; pos[i * 3 + 1] = src[i * 3 + 2]; pos[i * 3 + 2] = -src[i * 3 + 1]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.slice(8 + nv * 12, 8 + nv * 12 + ni * 4)), 1));
    geo.computeVertexNormals();
    geo.boundsTree = new MeshBVH(geo);
    W.mesh = new THREE.Mesh(geo, mat);
    W.mesh.raycast = acceleratedRaycast;
    scene.add(W.mesh);
    W.panos = meta.panos.map((p) => ({
      p, w: toWorld(p.p),
      rot: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]).invert())),
    }));
    W.ready = true;
  }

  function placeAt(entry, faceInward = true) {
    const w = entry.w;
    const fl = floorUnder(w.x, w.y - 1.3, w.z);
    W.pos.set(w.x, (fl ?? w.y - 1.45) + EYE, w.z);
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
    pickPanos(true);
    return true;
  }

  // the two scan points to project from: nearest to the eye, same floor and in sight preferred
  function pickPanos(force) {
    W.losClock++;
    if (!force && W.losClock % 5) return;
    const eye = W.pos;
    const ranked = [];
    for (const o of W.panos) {
      let d = o.w.distanceTo(eye);
      if (Math.abs(o.w.y - eye.y) > 1.3) d += 30;
      else if (d > 0.4) {
        tmp2.copy(o.w).sub(eye).normalize();
        const h = hit(eye, tmp2, d - 0.15);
        if (h) d += 4; // behind a wall: only if nothing better
      }
      ranked.push({ o, d });
    }
    ranked.sort((x, y) => x.d - y.d);
    const ready = (o) => { const e = atlases.get(atlasKey(o.p)); return e && e.tex ? e : null; };
    // ask for the best three, show the best two that have arrived
    ranked.slice(0, 3).forEach((r) => loadAtlas(r.o.p));
    const have = ranked.filter((r) => ready(r.o));
    if (!have.length) return;
    const A = have[0], B = have[1];
    W.a = A.o; W.b = B ? B.o : null;
    W.wantMix = B ? THREE.MathUtils.smoothstep(A.d / (A.d + B.d), 0.36, 0.5) * 0.5 : 0;
    if (W.near !== A.o.p) { W.near = A.o.p; hooks.onPano && hooks.onPano(A.o.p); }
  }

  function applyUniforms(dt) {
    const u = mat.uniforms;
    const ea = W.a && atlases.get(atlasKey(W.a.p)), eb = W.b && atlases.get(atlasKey(W.b.p));
    if (ea && ea.tex) {
      if (!ea.depth) ea.depth = bakeDepth(W.a.w);
      u.atlasA.value = ea.tex; u.posA.value.set(W.a.p.p[0], W.a.p.p[1], W.a.p.p[2]); u.rotA.value.copy(W.a.rot);
      u.depthA.value = ea.depth.texture; u.wposA.value.copy(W.a.w);
    }
    if (eb && eb.tex) {
      if (!eb.depth) eb.depth = bakeDepth(W.b.w);
      u.atlasB.value = eb.tex; u.posB.value.set(W.b.p.p[0], W.b.p.p[1], W.b.p.p[2]); u.rotB.value.copy(W.b.rot);
      u.depthB.value = eb.depth.texture; u.wposB.value.copy(W.b.w);
    }
    u.useDepth.value = ea && ea.depth && eb && eb.depth ? 1 : 0;
    const want = eb && eb.tex ? (W.wantMix || 0) : 0;
    // when the pair changes the blend restarts from the side that stayed
    if (W.lastA !== W.a || W.lastB !== W.b) {
      if (W.lastA === W.b && W.lastB === W.a) u.mixB.value = 1 - u.mixB.value;
      else if (W.lastB === W.a) u.mixB.value = Math.max(0, 1 - u.mixB.value - 0.5);
      else if (W.lastA !== W.a) u.mixB.value = want;
      W.lastA = W.a; W.lastB = W.b;
    }
    u.mixB.value += (want - u.mixB.value) * Math.min(1, dt * 6);
  }

  function move(dt) {
    const k = ctx.input.keys;
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    W.yaw += turn * dt * 1.9;
    const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    W.pitch = THREE.MathUtils.clamp(W.pitch + tilt * dt, -1.25, 1.25);
    if (W.glide) {
      const g = W.glide;
      g.t = Math.min(1, g.t + dt / g.dur);
      const e = g.t * g.t * (3 - 2 * g.t);
      W.pos.lerpVectors(g.from, g.to, e);
      if (g.t >= 1) W.glide = null;
      return;
    }
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const ax = (W.pad && W.pad.x) || 0, ay = (W.pad && W.pad.y) || 0;
    let mx = (-Math.sin(W.yaw)) * (f + ay) + Math.cos(W.yaw) * (s + ax), mz = (-Math.cos(W.yaw)) * (f + ay) - Math.sin(W.yaw) * (s + ax);
    const len = Math.hypot(mx, mz);
    const feet = W.pos.y - EYE;
    if (len > 0.01) {
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 4.2 : 2.3) * dt;
      mx = (mx / len) * speed; mz = (mz / len) * speed;
      // two tries: straight, then sliding along whatever was hit
      for (let pass = 0; pass < 2; pass++) {
        const l = Math.hypot(mx, mz);
        if (l < 1e-5) break;
        tmp2.set(mx / l, 0, mz / l);
        let blocked = null;
        for (const hgt of [STEP_UP + 0.1, 1.15]) {
          const h = hit(tmp.set(W.pos.x, feet + hgt, W.pos.z), tmp2, l + RADIUS);
          if (h && (!blocked || h.distance < blocked.distance)) blocked = h;
        }
        if (!blocked) { W.pos.x += mx; W.pos.z += mz; break; }
        nrm.copy(blocked.face.normal);
        nrm.y = 0;
        if (nrm.lengthSq() < 1e-6) { mx = mz = 0; break; }
        nrm.normalize();
        if (nrm.x * tmp2.x + nrm.z * tmp2.z > 0) nrm.negate(); // face the walker
        const dot = mx * nrm.x + mz * nrm.z;
        mx -= dot * nrm.x; mz -= dot * nrm.z;
        const room = Math.max(0, blocked.distance - RADIUS);
        W.pos.x += tmp2.x * Math.min(room, l) * 0.9; W.pos.z += tmp2.z * Math.min(room, l) * 0.9;
      }
    }
    const fl = floorUnder(W.pos.x, feet, W.pos.z);
    if (fl !== null) W.pos.y += (fl + EYE - W.pos.y) * Math.min(1, dt * 12);
  }

  function render(dt) {
    if (!W.ready) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    move(dt);
    pickPanos(false);
    applyUniforms(dt);
    cam.position.copy(W.pos);
    cam.rotation.set(W.pitch, W.yaw, 0);
    ctx.renderer.render(scene, cam);
  }

  function goTo(pano) {
    const entry = W.panos.find((o) => o.p === pano);
    if (!entry || W.glide) return;
    const fl = floorUnder(entry.w.x, entry.w.y - 1.3, entry.w.z);
    const to = new THREE.Vector3(entry.w.x, (fl ?? entry.w.y - 1.45) + EYE, entry.w.z);
    const d = to.distanceTo(W.pos);
    loadAtlas(entry.p);
    W.glide = { from: W.pos.clone(), to, t: 0, dur: THREE.MathUtils.clamp(d / 3.2, 0.5, 2.2) };
    const dx = to.x - W.pos.x, dz = to.z - W.pos.z;
    if (Math.hypot(dx, dz) > 0.5) W.yaw = Math.atan2(-dx, -dz);
  }
  // "walk on": glide to the scan point most in front of us (demo mode, phone button)
  function forward() {
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
    for (const e of atlases.values()) { if (e.tex) e.tex.dispose(); if (e.depth) e.depth.dispose(); }
    atlases.clear();
    mat.uniforms.atlasA.value = blank; mat.uniforms.atlasB.value = blank;
    mat.uniforms.depthA.value = emptyCube.texture; mat.uniforms.depthB.value = emptyCube.texture; mat.uniforms.useDepth.value = 0;
    W.ready = false; W.a = W.b = W.lastA = W.lastB = null; W.near = null; W.glide = null; W.pad = null;
  }

  return {
    load, start, render, stop, goTo, forward, state: W,
    look(dx, dy = 0) { W.yaw += dx; W.pitch = THREE.MathUtils.clamp(W.pitch + dy, -1.25, 1.25); },
    setEmpty(on) { W.empty = on; W.near = null; pickPanos(true); },
    setPad(x, y) { W.pad = { x, y }; },
    debugPlace(entry, yaw) { placeAt(entry, false); W.yaw = yaw; W.pitch = 0; pickPanos(true); },
    get ready() { return W.ready; },
    info() { return { x: W.pos.x, y: W.pos.y, z: W.pos.z, yaw: W.yaw, a: W.a?.p.id, b: W.b?.p.id }; },
  };
}
