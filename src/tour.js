// Walk inside. Path W: free walking with WASD through the scan's 3D mesh with the real photos
// projected onto it (src/walk.js), the default when a home has a mesh. Path A: the real
// Matterport Showcase in a full screen iframe, driven through the Embed SDK (localhost only).
// Path B: our own skybox viewer in Three.js, used in mock mode and when nothing else is
// available. T cycles between them. If none has data, a photo gallery keeps the flow going.
import * as THREE from 'three';
import { priceText, factsText } from './format.js';
import { createWalk } from './walk.js';
import { attachRail } from './showcaseRail.js';

const CONNECT_TIMEOUT = 8000;
// Skybox face order: 0 up, 1 to 4 around the horizon, 5 down. Each entry maps image
// coordinates u, v in [-1, 1] (u right, v down) to a direction in the skybox frame
// (x right, y up, z forward).
const FACE = [
  (u, v) => [u, 1, v],
  (u, v) => [u, -v, 1],
  (u, v) => [1, -v, -u],
  (u, v) => [-u, -v, -1],
  (u, v) => [-1, -v, u],
  (u, v) => [u, -1, -v],
];
const EYE = 1.45; // rough camera height above the floor, meters

function faceGeometry(k) {
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [];
  for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const d = FACE[k](a * 2 - 1, b * 2 - 1);
    pos.push(d[0] * 10, d[1] * 10, -d[2] * 10); // flip z: the skybox frame is left handed
    uv.push(a, 1 - b);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.MP_SDK) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('sdk script'));
    document.head.append(s);
  });
}

export function initTour(ctx) {
  const root = document.createElement('div');
  root.id = 'tour';
  root.innerHTML = `
    <div class="stage"></div>
    <div class="gallery"><img alt=""/><button class="prev">&#8249;</button><button class="next">&#8250;</button><div class="count"></div></div>
    <div class="top panel"><div class="body">
      <div class="tprice"></div><div class="tfacts"></div><div class="taddr"></div>
      <div class="troom"></div>
    </div></div>
    <div class="vignette"></div>
    <div class="rtoast"></div>
    <canvas class="fmap" width="320" height="320"></canvas>
    <div class="bar">
      <button data-act="auto"><kbd>P</kbd> <span>Tour</span></button>
      <button data-act="empty"><kbd>G</kbd> See it empty</button>
      <button data-act="next"><kbd>N</kbd> Next space</button>
      <button data-act="switch"><kbd>T</kbd> <span>Switch view</span></button>
      <button data-act="exit"><kbd>Esc</kbd> Exit to car</button>
    </div>
    <div class="hint"></div>`;
  document.body.append(root);
  const q = (s) => root.querySelector(s);
  const stage = q('.stage'), fmap = q('.fmap'), hint = q('.hint');

  const T = {
    active: false, listing: null, models: [], modelIndex: 0, path: null, meta: null, sdk: null, iframe: null,
    pano: null, empty: false, yaw: 0, pitch: 0, sweepId: null, gallery: [], gi: 0, token: 0, startedAt: 0,
  };

  const walk = createWalk(ctx, {
    onPano(p) {
      T.pano = p;
      updateOverlay();
      // walking into another room: say which one and how big
      if (T.path === 'W' && p.room !== T.lastRoom) {
        T.lastRoom = p.room;
        const r = T.meta?.rooms?.find((x) => x.id === p.room);
        const name = p.roomLabel || r?.label;
        if (name) roomToast(name, r?.area ? `${Math.round(r.area * 10.764).toLocaleString('en-US')} sqft` : '');
      }
    },
    onStep(speed) { ctx.audio.step(speed); },
  });
  let toastTimer = 0;
  function roomToast(name, detail) {
    const el = q('.rtoast');
    el.innerHTML = `<b></b><span></span>`;
    el.firstChild.textContent = name;
    el.lastChild.textContent = detail;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- Path B scene
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(74, 1, 0.05, 200);
  cam.rotation.order = 'YXZ';
  const loader = new THREE.TextureLoader();
  const cubes = [0, 1].map(() => {
    const g = new THREE.Group();
    g.userData.mats = [];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(faceGeometry(k), m);
      mesh.renderOrder = 0;
      g.add(mesh);
      g.userData.mats.push(m);
    }
    scene.add(g);
    return g;
  });
  cubes[1].visible = false;
  let front = 0;
  const discGroup = new THREE.Group();
  scene.add(discGroup);
  const discGeo = new THREE.RingGeometry(0.22, 0.34, 28);
  discGeo.rotateX(-Math.PI / 2);
  const discFill = new THREE.CircleGeometry(0.2, 24);
  discFill.rotateX(-Math.PI / 2);
  const ray = new THREE.Raycaster();
  let fadeK = 1, fading = false, hover = null;
  const texCache = new Map();

  function faceTextures(prefix) {
    if (!texCache.has(prefix)) {
      texCache.set(prefix, Promise.all([0, 1, 2, 3, 4, 5].map((k) => new Promise((res, rej) => {
        loader.load(`${ctx.world.base}${prefix}_${k}.jpg`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; res(t); }, undefined, rej);
      }))));
    }
    return texCache.get(prefix);
  }

  const mQ = new THREE.Quaternion(), mV = new THREE.Vector3();
  // A direction in model coordinates (z up) as seen from this pano, in our viewer's frame.
  // Calibrated against the Showcase (tests/calibrate.spec.js): undo the pano's rotation, then
  // local x is behind the first horizon face's left edge: view = (-y, z, -x).
  function modelToView(pano, v) {
    mQ.set(pano.q[0], pano.q[1], pano.q[2], pano.q[3]).invert();
    mV.set(v[0], v[1], v[2]).applyQuaternion(mQ);
    return new THREE.Vector3(-mV.y, mV.z, -mV.x);
  }

  function rebuildDiscs() {
    discGroup.clear();
    const cur = T.pano;
    for (const p of T.meta.panos) {
      if (p === cur) continue;
      const d = [p.p[0] - cur.p[0], p.p[1] - cur.p[1], p.p[2] - cur.p[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      if (dist > 14) continue;
      const v = modelToView(cur, d);
      const g = new THREE.Group();
      const ring = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
      const fill = new THREE.Mesh(discFill, new THREE.MeshBasicMaterial({ color: 0xffc940, transparent: true, opacity: 0.55, depthTest: false }));
      ring.renderOrder = 2; fill.renderOrder = 2;
      g.add(fill, ring);
      g.position.set(v.x, v.y - EYE, v.z);
      g.userData.pano = p;
      discGroup.add(g);
    }
  }

  async function showPano(pano, instant = false) {
    const token = T.token;
    const prefix = T.empty && pano.empty ? pano.empty : pano.faces;
    let texes;
    try { texes = await faceTextures(prefix); } catch { return false; }
    if (token !== T.token) return false;
    // keep the same view direction in model space across the move
    const back = 1 - front;
    cubes[back].userData.mats.forEach((m, k) => { m.map = texes[k]; m.opacity = instant ? 1 : 0; m.needsUpdate = true; });
    cubes[back].visible = true;
    cubes[back].children.forEach((c) => (c.renderOrder = 1));
    cubes[front].children.forEach((c) => (c.renderOrder = 0));
    if (T.pano && T.pano !== pano && !instant) {
      // carry the heading: where we looked in model space stays where we look
      const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(T.pitch, T.yaw, 0, 'YXZ'));
      const inv = viewToModel(T.pano, look);
      const again = modelToView(pano, inv);
      T.yaw = Math.atan2(-again.x, -again.z);
    }
    T.pano = pano;
    front = back;
    fadeK = instant ? 1 : 0;
    fading = !instant;
    if (instant) cubes[1 - front].visible = false;
    rebuildDiscs();
    updateOverlay();
    return true;
  }
  function viewToModel(pano, v) {
    const s = new THREE.Vector3(-v.z, -v.x, v.y);
    s.applyQuaternion(new THREE.Quaternion(pano.q[0], pano.q[1], pano.q[2], pano.q[3]));
    return [s.x, s.y, s.z];
  }

  function discAhead() {
    const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, T.yaw, 0, 'YXZ'));
    let best = null, bs = 0.35;
    for (const g of discGroup.children) {
      const d = g.position.clone().setY(0);
      const dist = d.length();
      const dot = d.normalize().dot(look);
      const score = dot - dist * 0.02;
      if (score > bs) { bs = score; best = g; }
    }
    return best;
  }

  function renderB(dt) {
    const w = window.innerWidth, h = window.innerHeight;
    if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    const k = ctx.input.keys;
    const turn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    T.yaw += turn * dt * 1.6;
    const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    T.pitch = THREE.MathUtils.clamp(T.pitch + tilt * dt, -1.2, 1.2);
    cam.rotation.set(T.pitch, T.yaw, 0);
    if (fading) {
      fadeK = Math.min(1, fadeK + dt / 0.55);
      cubes[front].userData.mats.forEach((m) => (m.opacity = fadeK));
      cam.fov = 74 - Math.sin(fadeK * Math.PI) * 9;
      cam.updateProjectionMatrix();
      if (fadeK >= 1) { fading = false; cubes[1 - front].visible = false; }
    }
    const ahead = discAhead();
    const t = performance.now() / 1000;
    for (const g of discGroup.children) {
      const on = g === ahead || g === hover;
      g.scale.setScalar(on ? 1.5 + Math.sin(t * 5) * 0.12 : 1);
      g.children[0].material.opacity = on ? 0.9 : 0.5;
    }
    ctx.renderer.render(scene, cam);
    drawMap();
  }

  // ---------------------------------------------------------------- overlay
  function updateOverlay() {
    const l = T.listing;
    q('.tprice').textContent = priceText(l);
    q('.tfacts').textContent = factsText(l);
    q('.taddr').textContent = (l.name ? l.name + ' · ' : '') + l.address;
    let room = '';
    if (T.pano) {
      const r = T.meta?.rooms?.find((x) => x.id === T.pano.room);
      room = T.pano.roomLabel || r?.label || '';
      if (r?.area) room += ` · ${Math.round(r.area * 10.764)} sqft`;
    }
    q('.troom').textContent = room ? room : T.path === 'A' ? 'Matterport 3D tour' : T.path === 'W' ? 'Walking through' : '';
    const hasEmpty = !!T.meta?.panos?.some((p) => p.empty);
    const be = q('[data-act="empty"]');
    be.style.display = hasEmpty ? '' : 'none';
    be.lastChild.textContent = T.path === 'W' ? ' See it empty (photo view)' : T.empty ? ' Furnished' : ' See it empty';
    q('[data-act="next"]').style.display = T.models.length > 1 ? '' : 'none';
    q('[data-act="auto"]').style.display = (T.path === 'A' && T.rail) || T.path === 'W' ? '' : 'none';
    const nxt = nextPath();
    q('[data-act="switch"]').style.display = nxt ? '' : 'none';
    q('[data-act="switch"] span').textContent = { W: 'Walk freely', A: 'Matterport view', B: 'Photo spots' }[nxt] || '';
    root.dataset.path = T.path || '';
    fmap.style.display = T.meta && T.meta.panos.length > 1 ? '' : 'none';
    ctx.emit('tour-state', api.info());
  }

  function drawMap() {
    if (!T.meta || T.meta.panos.length < 2) return;
    const g = fmap.getContext('2d');
    const W = fmap.width;
    g.clearRect(0, 0, W, W);
    const ps = T.meta.panos;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of ps) { minX = Math.min(minX, p.p[0]); maxX = Math.max(maxX, p.p[0]); minY = Math.min(minY, p.p[1]); maxY = Math.max(maxY, p.p[1]); }
    const sc = (W - 70) / Math.max(1, maxX - minX, maxY - minY);
    const X = (p) => W / 2 + (p.p[0] - (minX + maxX) / 2) * sc, Y = (p) => W / 2 - (p.p[1] - (minY + maxY) / 2) * sc;
    g.fillStyle = 'rgba(16,20,27,0.82)';
    g.beginPath(); g.roundRect(0, 0, W, W, 36); g.fill();
    g.strokeStyle = 'rgba(255,250,240,0.25)'; g.lineWidth = 3;
    for (const p of ps) for (const n of p.n || []) {
      const o = ps.find((x) => x.id === n);
      if (o) { g.beginPath(); g.moveTo(X(p), Y(p)); g.lineTo(X(o), Y(o)); g.stroke(); }
    }
    for (const p of ps) {
      const cur = p === T.pano || (T.path === 'A' && p.id === T.sweepId);
      g.beginPath(); g.arc(X(p), Y(p), cur ? 13 : 8, 0, Math.PI * 2);
      g.fillStyle = cur && T.path !== 'W' ? '#ffc940' : '#fffaf0'; g.fill();
    }
    if (T.path === 'W') {
      const w = walk.state, me = { p: [w.pos.x, -w.pos.z] };
      g.save();
      g.translate(X(me), Y(me)); g.rotate(-w.yaw);
      g.beginPath(); g.moveTo(0, -17); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath();
      g.fillStyle = '#ffc940'; g.fill();
      g.restore();
    }
  }
  fmap.addEventListener('click', (e) => {
    if (!T.meta) return;
    const r = fmap.getBoundingClientRect();
    const W = fmap.width, mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * W;
    const ps = T.meta.panos;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of ps) { minX = Math.min(minX, p.p[0]); maxX = Math.max(maxX, p.p[0]); minY = Math.min(minY, p.p[1]); maxY = Math.max(maxY, p.p[1]); }
    const sc = (W - 70) / Math.max(1, maxX - minX, maxY - minY);
    let best = null, bd = 40;
    for (const p of ps) {
      const d = Math.hypot(W / 2 + (p.p[0] - (minX + maxX) / 2) * sc - mx, W / 2 - (p.p[1] - (minY + maxY) / 2) * sc - my);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) goTo(best);
  });

  // ---------------------------------------------------------------- pointer look (Path B)
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { if (T.path === 'B' || T.path === 'W') { drag = { x: e.clientX, y: e.clientY, moved: 0 }; stage.setPointerCapture(e.pointerId); } });
  stage.addEventListener('pointermove', (e) => {
    if (T.path === 'W') {
      if (drag && document.pointerLockElement !== stage) { walk.look((e.clientX - drag.x) * 0.0045, (e.clientY - drag.y) * 0.0045); drag.x = e.clientX; drag.y = e.clientY; }
      return;
    }
    if (T.path !== 'B') return;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      T.yaw += dx * 0.0045; T.pitch = THREE.MathUtils.clamp(T.pitch + dy * 0.0045, -1.2, 1.2);
      drag.x = e.clientX; drag.y = e.clientY;
    }
    hover = pickDisc(e);
    stage.style.cursor = hover ? 'pointer' : 'grab';
  });
  stage.addEventListener('pointerup', (e) => {
    if (T.path === 'W') { drag = null; return; }
    if (T.path !== 'B' || !drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved < 6) { const d = pickDisc(e); if (d) goTo(d.userData.pano); }
  });
  stage.addEventListener('click', () => {
    if (T.path === 'W' && document.pointerLockElement !== stage && stage.requestPointerLock) {
      try { const r = stage.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* not allowed right now */ }
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (T.path === 'W' && document.pointerLockElement === stage) walk.look(-e.movementX * 0.0023, -e.movementY * 0.0023);
  });
  document.addEventListener('pointerlockchange', () => {
    if (T.path === 'W') hint.textContent = document.pointerLockElement === stage ? 'WASD walk · mouse looks · Shift runs · Esc frees the mouse' : WALK_HINT;
  });
  const freeMouse = () => { if (document.pointerLockElement === stage && document.exitPointerLock) document.exitPointerLock(); };
  const WALK_HINT = 'W S along the route · A D pick a branch · drag to look · Shift faster · P tour · F free walk · T other views';
  const FREE_HINT = 'WASD walk · click to look with the mouse (or drag) · Shift runs · F back on the route · T other views';
  const RAIL_HINT = 'W S along the route · A D pick a branch · drag to look · Shift faster · P tour · T other views · Esc exits';
  function pickDisc(e) {
    ray.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), cam);
    let best = null, ba = 0.09;
    for (const g of discGroup.children) {
      const a = ray.ray.direction.angleTo(g.position.clone().normalize());
      if (a < ba) { ba = a; best = g; }
    }
    return best;
  }

  // ---------------------------------------------------------------- moving around
  function goTo(pano) {
    if (!pano) return;
    if (T.path === 'W') { walk.goTo(pano); return; }
    if (T.path === 'A' && T.sdk) {
      T.sdk.Sweep.moveTo(pano.id, { transition: T.sdk.Sweep.Transition.FLY }).catch(() => {});
      return;
    }
    if (T.path === 'B' && !fading) { ctx.audio.blip(520, 0.08); showPano(pano); }
  }
  function forward() {
    if (T.path === 'A' && T.rail) return; // on rails W itself walks on
    if (T.path === 'W') { walk.forward(); return; }
    if (T.path === 'B') { const d = discAhead(); if (d) goTo(d.userData.pano); return; }
    if (T.path === 'A') stepSweep(1);
    if (T.path === 'G') galleryStep(1);
  }
  function stepSweep(dir) {
    const ps = T.meta?.panos;
    if (ps && ps.length) {
      const i = Math.max(0, ps.findIndex((p) => p.id === (T.path === 'A' ? T.sweepId : T.pano?.id)));
      goTo(ps[(i + dir + ps.length) % ps.length]);
    } else if (T.sdk && T.sweeps?.length) {
      const i = Math.max(0, T.sweeps.findIndex((s) => s.id === T.sweepId));
      T.sdk.Sweep.moveTo(T.sweeps[(i + dir + T.sweeps.length) % T.sweeps.length].id, { transition: T.sdk.Sweep.Transition.FLY }).catch(() => {});
    }
  }
  function look(dx, dy = 0) {
    if (T.path === 'A' && T.rail) T.rail.look(dx, dy);
    else if (T.path === 'W') walk.look(dx, dy);
    else if (T.path === 'B') { T.yaw += dx; T.pitch = THREE.MathUtils.clamp(T.pitch + dy, -1.2, 1.2); }
    else if (T.path === 'A' && T.sdk) T.sdk.Camera.rotate((-dx * 180) / Math.PI, (dy * 180) / Math.PI, { speed: 120 }).catch(() => {});
  }

  // ---------------------------------------------------------------- paths
  const canShowcase = () => !ctx.mock && !!ctx.config.matterportSdkKey && navigator.onLine !== false && !/^mock/.test(T.models[T.modelIndex] || '') && !ctx.params.has('noshowcase');

  async function loadMeta(id) {
    try {
      const res = await fetch(`${ctx.world.base}mp/${id}.json`);
      if (!res.ok || (res.headers.get('content-type') || '').includes('html')) return null;
      return await res.json();
    } catch { return null; }
  }

  function clearStage() {
    if (T.rail) { T.rail.dispose(); T.rail = null; }
    delete root.dataset.rail;
    if (T.iframe) { T.iframe.remove(); T.iframe = null; }
    T.sdk = null; T.sweeps = null;
    walk.stop();
    freeMouse();
    ctx.audio.roomTone(false);
    q('.rtoast').classList.remove('show');
    root.classList.remove('gal');
  }

  async function startA(id) {
    const token = T.token;
    clearStage();
    T.path = 'A';
    updateOverlay();
    hint.textContent = 'Click or drag to walk · W next spot · T simple view · Esc exits';
    const key = ctx.config.matterportSdkKey;
    const iframe = document.createElement('iframe');
    iframe.allow = 'xr-spatial-tracking; fullscreen';
    // With the Showcase SDK bundle on our own origin (public/mp-bundle/, local only) the scene
    // API is there and our camera can ride rails through the home. Without it: the embed.
    if (T.bundle === undefined) {
      // version.txt is a small file in the bundle; a dev server answers unknown paths with a web page
      T.bundle = !ctx.params.has('nobundle') && await fetch('/mp-bundle/version.txt').then((r) => (r.ok ? r.text() : ''), () => '').then((t) => !!t && t.length < 200 && !/</.test(t));
    }
    const params = `m=${encodeURIComponent(id)}&play=1&qs=1&brand=0&help=0&title=0&search=0&applicationKey=${encodeURIComponent(key)}`;
    iframe.src = T.bundle ? `/mp-bundle/showcase.html?${params}` : `${ctx.config.showcaseBase.replace(/\/$/, '')}/show?${params}`;
    stage.append(iframe);
    T.iframe = iframe;
    try {
      if (!T.bundle) await loadScript(ctx.config.sdkUrl || 'https://static.matterport.com/showcase-sdk/latest.js');
      const connectBundle = async () => {
        for (let i = 0; i < 200 && !(iframe.contentWindow && iframe.contentWindow.MP_SDK); i++) await new Promise((r) => setTimeout(r, 50));
        return iframe.contentWindow.MP_SDK.connect(iframe.contentWindow);
      };
      const sdk = await Promise.race([
        T.bundle ? connectBundle() : window.MP_SDK.connect(iframe, key, ''),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), CONNECT_TIMEOUT)),
      ]);
      if (token !== T.token) return true;
      T.sdk = sdk;
      window.__gpa.tour = { path: 'A', connected: true };
      if (T.bundle) {
        try {
          await sdk.App.state.waitUntil((s) => s.phase === sdk.App.Phase.PLAYING);
          if (token !== T.token) return true;
          T.rail = await attachRail(ctx, sdk, iframe.contentWindow, {
            onMode(m) { root.dataset.rail = m; },
            onTourEnd() { updateOverlay(); },
          });
          if (token !== T.token) { T.rail.dispose(); T.rail = null; return true; }
          hint.textContent = RAIL_HINT;
          window.__gpa.tour = { path: 'A', connected: true, rail: true, sweeps: T.rail.info().sweeps };
          updateOverlay();
        } catch (e) {
          console.warn('[tour] rails are not available in this Showcase:', e.message);
        }
      }
      try {
        const data = await sdk.Model.getData();
        T.sweeps = (data.sweeps || []).map((s) => ({ id: s.uuid || s.sid || s.id }));
      } catch { /* optional */ }
      sdk.Sweep.current.subscribe((s) => {
        if (!s || !s.sid && !s.id) return;
        T.sweepId = s.id || s.sid;
        const p = T.meta?.panos?.find((x) => x.id === T.sweepId);
        if (p) T.pano = p;
        updateOverlay();
      });
      try {
        sdk.Room.current.subscribe((r) => {
          const first = r?.rooms?.[0];
          const lab = T.meta?.rooms?.find((x) => x.id === first?.id)?.label;
          if (lab && !T.meta?.panos?.find((x) => x.id === T.sweepId)) q('.troom').textContent = lab;
        });
      } catch { /* older SDK */ }
      return true;
    } catch (e) {
      if (token !== T.token) return true;
      console.warn('[tour] Showcase did not connect:', e.message);
      window.__gpa.tour = { path: 'A', connected: false };
      return false;
    }
  }

  async function startB(startPano) {
    clearStage();
    if (!T.meta || !T.meta.panos.length) return false;
    T.path = 'B';
    T.pano = null;
    T.pitch = 0;
    const p = startPano || T.meta.panos[0];
    const ok = await showPano(p, true);
    if (!ok) return false;
    // start out facing into the home: toward the middle of the other scan positions
    const others = T.meta.panos.filter((x) => x !== p);
    if (others.length) {
      const c = [0, 1, 2].map((k) => others.reduce((a, x) => a + x.p[k], 0) / others.length - p.p[k]);
      const v = modelToView(p, c);
      if (Math.hypot(v.x, v.z) > 0.3) T.yaw = Math.atan2(-v.x, -v.z);
    }
    hint.textContent = 'Drag to look · W or click a ring to walk · G empty · Esc exits';
    window.__gpa.tour = { path: 'B', panos: T.meta.panos.length };
    updateOverlay();
    return true;
  }

  async function startW(startPano) {
    const token = T.token;
    clearStage();
    if (!T.meta || !T.meta.mesh || !T.meta.panos.length) return false;
    T.path = 'W';
    T.pano = startPano || T.meta.panos[0];
    updateOverlay();
    try {
      await walk.load(ctx.world.base, T.meta);
      if (token !== T.token) return true;
      T.lastRoom = null;
      if (!(await walk.start(T.pano))) { walk.stop(); return false; }
    } catch (e) {
      console.warn('[tour] walk mode failed:', e.message);
      walk.stop();
      return false;
    }
    if (token !== T.token) return true;
    hint.textContent = walk.onRails ? WALK_HINT : FREE_HINT;
    ctx.audio.roomTone(true);
    window.__gpa.tour = { path: 'W', panos: T.meta.panos.length };
    updateOverlay();
    return true;
  }
  // T cycles: walk freely, the Matterport Showcase, the photo spots
  function nextPath() {
    const have = { W: !!T.meta?.mesh, A: canShowcase(), B: !!T.meta?.panos?.length };
    const order = ['W', 'A', 'B'];
    const i = order.indexOf(T.path);
    if (i < 0) return null;
    for (let k = 1; k < 3; k++) { const n = order[(i + k) % 3]; if (have[n]) return n; }
    return null;
  }

  function startGallery() {
    clearStage();
    const l = T.listing;
    T.gallery = [...new Set([...ctx.hud.photoSources(l), ...(l.curbPhotos || []).map((p) => ctx.world.base + p)])];
    T.gi = 0;
    T.path = 'G';
    root.classList.add('gal');
    galleryStep(0);
    hint.textContent = 'Arrow keys flip through the photos · Esc exits';
    console.warn('[tour] no 3D data for this home, showing the photo gallery');
    window.__gpa.tour = { path: 'G', photos: T.gallery.length };
    updateOverlay();
  }
  function galleryStep(d) {
    if (!T.gallery.length) { q('.gallery .count').textContent = 'No photos for this home'; q('.gallery img').removeAttribute('src'); return; }
    T.gi = (T.gi + d + T.gallery.length) % T.gallery.length;
    q('.gallery img').src = T.gallery[T.gi];
    q('.gallery .count').textContent = `${T.gi + 1} / ${T.gallery.length}`;
  }
  q('.gallery .prev').addEventListener('click', () => galleryStep(-1));
  q('.gallery .next').addEventListener('click', () => galleryStep(1));

  async function openModel(index, prefer) {
    const token = ++T.token;
    T.modelIndex = index;
    const id = T.models[index];
    T.empty = false; T.sweepId = null; T.pano = null;
    T.meta = await loadMeta(id);
    if (token !== T.token) return;
    if ((!prefer || prefer === 'W') && await startW()) return;
    if (token !== T.token) return;
    const wantA = prefer ? prefer === 'A' : canShowcase();
    if (wantA && canShowcase() && await startA(id)) return;
    if (token !== T.token) return;
    if (await startB()) return;
    if (token !== T.token) return;
    if (!wantA && canShowcase() && await startA(id)) return;
    startGallery();
  }

  // ---------------------------------------------------------------- enter / exit
  async function enter(listing, models) {
    if (T.active) return;
    T.active = true;
    T.listing = listing;
    T.models = models && models.length ? models : (listing.matterportIds || []);
    T.startedAt = performance.now();
    ctx.state = 'tour';
    ctx.hud.setPlayVisible(false);
    const s = ctx.car.state;
    s.vx = s.vz = 0;
    const b = listing.building;
    const target = b ? { x: b.cx + (s.x - b.cx) * 0.35, y: ctx.world.heightAt(b.cx, b.cz), z: b.cz + (s.z - b.cz) * 0.35 } : { x: listing.x, y: s.y, z: listing.z };
    ctx.audio.chime();
    ctx.cam.swoop(target, null, 1.1);
    await new Promise((r) => setTimeout(r, 650));
    await ctx.hud.fade(true, 450);
    root.classList.add('show');
    ctx.skipRender = true;
    ctx.emit('tour-enter', listing);
    await openModel(0, { b: 'B', a: 'A', w: 'W' }[ctx.params.get('tour')] || null);
    await ctx.hud.fade(false, 500);
  }

  async function exit() {
    if (!T.active) return;
    const listing = T.listing;
    T.token++;
    await ctx.hud.fade(true, 350);
    clearStage();
    root.classList.remove('show');
    T.active = false; T.path = null; T.meta = null;
    ctx.skipRender = false;
    ctx.cam.setMode('chase');
    ctx.cam.snap();
    ctx.state = 'play';
    ctx.hud.setPlayVisible(true);
    window.__gpa.tour = null;
    await ctx.hud.fade(false, 450);
    ctx.emit('tour-exit', listing, (performance.now() - T.startedAt) / 1000);
  }

  async function toggleEmpty() {
    if (!T.meta?.panos?.some((p) => p.empty)) return;
    if (T.path === 'W') {
      // the furniture free panoramas only exist as photos: hop to the photo view at this spot
      const at = T.pano && T.pano.empty ? T.pano : T.meta.panos.find((x) => x.empty);
      T.token++;
      T.empty = true;
      await startB(at);
      hint.textContent = 'Empty rooms are shown in the photo view · G furnished · T back to walking';
      return;
    }
    if (T.path === 'A') {
      // the furniture free panoramas are ours: hop to the simple viewer at the nearest scan
      T.empty = true;
      const p = T.meta.panos.find((x) => x.id === T.sweepId && x.empty) || T.meta.panos.find((x) => x.empty);
      T.token++;
      await startB(p);
      return;
    }
    T.empty = !T.empty;
    const p = T.pano.empty || !T.empty ? T.pano : T.meta.panos.find((x) => x.empty);
    texSwap(p);
  }
  function texSwap(p) { fading = false; showPano(p); }

  async function switchPath() {
    if (!T.active) return;
    const n = nextPath();
    if (!n) return;
    const at = T.path === 'A' ? T.meta?.panos?.find((x) => x.id === T.sweepId) : T.pano;
    T.token++;
    T.empty = false;
    if (n === 'W' && await startW(at)) return;
    if (n === 'A' && await startA(T.models[T.modelIndex])) return;
    if (!(await startB(at))) startGallery();
  }
  // P: glide the whole route in about 45 seconds with a gentle look around, then back to the start
  function autoTour(seconds = 45) {
    if (T.path === 'A' && T.rail) { T.rail.tour(seconds); return true; }
    if (T.path === 'W') { walk.tour(seconds); return true; }
    return false;
  }
  function nextSpace() { if (T.models.length > 1) openModel((T.modelIndex + 1) % T.models.length); }

  root.querySelector('.bar').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'exit') exit();
    if (act === 'auto') autoTour();
    if (act === 'empty') toggleEmpty();
    if (act === 'next') nextSpace();
    if (act === 'switch') switchPath();
    e.target.closest('button')?.blur();
  });

  ctx.on('key', (code) => {
    if (!T.active) return;
    if (code === 'Escape') exit();
    else if (code === 'KeyT') switchPath();
    else if (code === 'KeyG') toggleEmpty();
    else if (code === 'KeyN') nextSpace();
    else if (code === 'KeyP') autoTour();
    else if (code === 'KeyF' && T.path === 'W') { hint.textContent = walk.toggleRail() ? WALK_HINT : FREE_HINT; }
    else if (T.path === 'A' && T.rail) { /* W, S, A and D are read by the rail every frame */ }
    else if (T.path === 'W') { if (code === 'Enter') forward(); }
    else if (code === 'KeyW' || code === 'Enter') forward();
    else if (code === 'KeyS') stepSweep(-1);
    else if (T.path === 'G' && code === 'ArrowRight') galleryStep(1);
    else if (T.path === 'G' && code === 'ArrowLeft') galleryStep(-1);
  });
  // Esc pressed while the iframe has focus never reaches us: watch for focus loss instead
  addEventListener('blur', () => { if (T.active && T.path === 'A') setTimeout(() => window.focus(), 0); });

  ctx.on('post', (dt) => {
    if (!T.active) return;
    if (T.path === 'B') renderB(dt);
    else if (T.path === 'W') { walk.render(dt); drawMap(); }
  });

  // ---------------------------------------------------------------- E on a listing
  ctx.on('key', (code) => {
    if (code !== 'KeyE' || ctx.state !== 'play' || ctx.hud.choosing) return;
    const l = ctx.listingsSys.near;
    if (!l || !(l.matterportIds || []).length) return;
    request(l);
  });
  function request(l) {
    const plans = (l.floorPlans || []).filter((f) => (f.matterportIds || []).length);
    if (l.kind === 'apartments' && plans.length) {
      const opts = [{ label: 'The community', detail: 'Lobby and shared spaces', models: l.matterportIds }, ...plans.slice(0, 7).map((f) => ({
        label: f.name || 'Floor plan', detail: `${f.beds === 0 ? 'Studio' : (f.beds ?? '?') + ' bd'}${f.rentMin ? ' · from $' + Number(f.rentMin).toLocaleString('en-US') : ''}${f.unitsAvailable ? ' · ' + f.unitsAvailable + ' open' : ''}`, models: f.matterportIds,
      }))];
      ctx.hud.choose('Which space do you want to walk into?', opts, (o) => { if (o) enter(l, o.models); });
    } else enter(l);
  }

  const api = {
    enter, exit, request, forward, look, toggleEmpty, switchPath, nextSpace, stepSweep,
    get active() { return T.active; },
    get path() { return T.path; },
    info() {
      return { active: T.active, path: T.path, room: q('.troom').textContent, hasEmpty: !!T.meta?.panos?.some((p) => p.empty), empty: T.empty, spaces: T.models.length, pano: T.pano?.id || T.sweepId, panos: T.meta?.panos?.length || 0 };
    },
    _state: T, walk,
    pad(x, y) { if (T.path === 'W') walk.setPad(x, y); else if (T.path === 'A' && T.rail) T.rail.setPad(y); },
    autoTour,
    rail() { return T.path === 'A' && T.rail ? T.rail.info() : T.path === 'W' ? walk.info().rail : null; },
    _show: (p) => showPano(p, true),
  };
  return api;
}
