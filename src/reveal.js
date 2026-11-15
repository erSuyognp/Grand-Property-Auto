// The property reveal: select a home (click its marker, click the minimap, pull up and press
// E, or from a mission) and the world shows what living there is like. The camera rises to a
// drone view, walk time rings grow from the home, the nearest places pop up with routes and
// times, solar panels drop onto the roof, a flood zone ripples in blue, and the insight panel
// slides in. Space skips to the end. Every number comes from the home's insight file.
import * as THREE from 'three';
import { findPath } from './nav.js';
import { iconUrl, icon, PLACE_ICON, PLACE_LABEL } from './icons.js';
import { extraFacts } from './mayaTools.js';

const PLACES = ['supermarket', 'school', 'park', 'transit', 'gym', 'hospital'];
export const CAT_COLOR = { supermarket: '#ffb020', school: '#7c9cff', park: '#3ddc84', transit: '#4cc9f0', gym: '#ff7ab6', hospital: '#ff6b6b', pharmacy: '#c59bff', cafe: '#e0a878', restaurant: '#ffa15c' };
const RING_COLORS = [0x4cc9f0, 0x3ddc84, 0xffc940]; // 15, 10, 5 minute walk
const spring = (k) => (k >= 1 ? 1 : 1 - Math.exp(-6.5 * k) * Math.cos(10 * k));
const smooth = (k) => k * k * (3 - 2 * k);

function pointIn(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function initReveal(ctx) {
  const labels = document.createElement('div');
  labels.id = 'reveal-labels';
  ctx.hud.root.append(labels);
  const reduced = () => ctx.settings?.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const texLoader = new THREE.TextureLoader();
  const pinTex = new Map();
  let cur = null, ins = null, group = null, T = 0, anims = [], chips = [], angle = 0, home = null, token = 0, stage = 0;
  let baseExposure = null, sunTime = null, zoom = 1;
  const v3 = new THREE.Vector3(), want = new THREE.Vector3(), wantLook = new THREE.Vector3();

  function pinTexture(cat) {
    if (pinTex.has(cat)) return pinTex.get(cat);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const draw = (img) => {
      g.clearRect(0, 0, 128, 128);
      g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2);
      g.fillStyle = CAT_COLOR[cat] || '#fff'; g.fill();
      g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
      if (img) g.drawImage(img, 30, 30, 68, 68);
      tex.needsUpdate = true;
    };
    draw(null);
    const img = new Image();
    img.onload = () => draw(img);
    img.src = iconUrl(PLACE_ICON[cat] || 'map-pin', '#14181f');
    pinTex.set(cat, tex);
    return tex;
  }

  function chip(html, cls = '') {
    const el = document.createElement('div');
    el.className = `rv-chip ${cls}`;
    el.innerHTML = html;
    labels.append(el);
    const c = { el, pos: new THREE.Vector3(), on: false, dy: 0 };
    chips.push(c);
    return c;
  }

  function ribbon(pts, color, width = 1.5) {
    const world = ctx.world, pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let dx = q.x - o.x, dz = q.z - o.z;
      const n = Math.hypot(dx, dz) || 1;
      dx /= n; dz /= n;
      const y = world.heightAt(p.x, p.z) + 0.8;
      pos.push(p.x - dz * width * 0.5, y, p.z + dx * width * 0.5, p.x + dz * width * 0.5, y, p.z - dx * width * 0.5);
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    m.renderOrder = 8; m.frustumCulled = false; m.userData.count = idx.length;
    return m;
  }

  const add = (t0, dur, fn, ease = spring) => anims.push({ t0, dur, fn, ease, done: false });

  // The reveal is told one step at a time so it can be followed: the home, how far you can walk,
  // each nearest place in turn, the roof, any flood zone, then the cards. Space moves to the
  // next step, Shift+Space (or the Skip button) jumps to the end. "Quick" keeps the short version.
  let P = null, beats = [];
  const guided = () => (ctx.params.get('pace') || ctx.settings?.revealPace || 'guided') !== 'quick';
  function plan(data) {
    const nPlaces = PLACES.filter((c) => data?.places?.[c]?.[0]).length;
    const nRings = (data?.rings?.walk || []).length;
    const solar = !!(data?.solar?.panels || data?.aerial?.solar), flood = !!data?.risk?.flood?.sfha;
    if (!guided()) return { outline: 0.5, ring: (i) => 1.0 + i * 0.32, place: (n) => 1.9 + n * 0.16, solar: 2.9, flood: 3.2, panel: 2.5, end: 4.2, wideIn: 0.9, wideOut: 3.3, guided: false };
    const ring0 = 2.2, place0 = ring0 + nRings * 1.0 + 0.5, gap = 1.25;
    // after the places: what it costs to own (insurance, HOA, amenities, tax), one step each
    const nFacts = Math.min(4, extraFacts(data).filter((x) => x.key !== 'energy' && !(x.key === 'risk' && flood)).length);
    const solarT = place0 + nPlaces * gap + 0.3, floodT = solarT + (solar ? 2.2 : 0), factT = floodT + (flood ? 2.2 : 0), panelT = factT + nFacts * 2.4 + 0.4;
    return { outline: 0.5, ring: (i) => ring0 + i * 1.0, place: (n) => place0 + n * gap, solar: solarT, flood: floodT, fact: (n) => factT + n * 2.4, nFacts, panel: panelT, end: panelT + 1.6, wideIn: ring0 - 0.4, wideOut: solarT - 0.5, guided: true };
  }
  const capEl = document.createElement('div');
  capEl.id = 'reveal-cap';
  ctx.hud.root.append(capEl);
  function caption(i, title, text) {
    if (!P?.guided || !cur) { capEl.classList.remove('show'); return; }
    const n = beats.length;
    capEl.innerHTML = `<div class="rc-top"><b>${title}</b><span>${beats.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</span></div><p>${text}</p><div class="rc-keys"><span><kbd>Space</kbd> next</span><button class="linkbtn" data-skip>Skip to the end</button></div>`;
    capEl.classList.add('show');
    capEl.querySelector('[data-skip]').addEventListener('click', () => skip());
    window.__gpa.revealStep = { i: i + 1, n, title };
  }
  // a beat: a moment in the story, with its caption
  const beat = (t, title, text) => { const i = beats.length; beats.push(t); add(t, 0.05, () => caption(i, title, text), smooth); };

  function build(l, data) {
    P = plan(data); beats = [];
    const world = ctx.world;
    group = new THREE.Group();
    ctx.scene.add(group);
    const b = l.building;
    const hx = b ? b.cx : l.x, hz = b ? b.cz : l.z;
    const ground = world.heightAt(hx, hz), top = b ? b.top : ground + 6;
    const size = b ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) : 14;
    home = { x: hx, z: hz, ground, top, size };
    const basic = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });

    // 1. footprint glow
    if (b) {
      const ring = b.pts.map((p) => new THREE.Vector3(p.x, 0, p.y));
      ring.push(ring[0].clone());
      const wallPos = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], c = ring[i + 1];
        wallPos.push(a.x, ground, a.z, c.x, ground, c.z, c.x, top + 1, c.z, a.x, ground, a.z, c.x, top + 1, c.z, a.x, top + 1, a.z);
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
      const walls = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0xffc940, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
      walls.renderOrder = 6;
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map((p) => new THREE.Vector3(p.x, top + 1, p.z))), new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthTest: false, toneMapped: false }));
      outline.renderOrder = 9;
      group.add(walls, outline);
      add(P.outline, 0.8, (k) => { walls.userData.o = 0.3 * k; outline.material.opacity = k; }, smooth);
      group.userData.walls = walls;
    }

    beat(0.2, 'This home', `${l.price != null ? '$' + Math.round(l.price).toLocaleString('en-US') : 'For rent'}${l.beds != null ? ` · ${l.beds} bed` : ''}${l.sqft ? ` · ${Number(l.sqft).toLocaleString('en-US')} sq ft` : ''}. Here is what living here is like.`);
    // 2. walk time rings: 5, 10, 15 minutes, growing outward one after another
    const rings = [...(data?.rings?.walk || [])].sort((a, c) => (P.guided ? a.min - c.min : c.min - a.min));
    rings.forEach((r, i) => {
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r.radiusM, 72), basic(RING_COLORS[i], 0.1));
      const edge = new THREE.Mesh(new THREE.RingGeometry(r.radiusM - 1.6, r.radiusM, 96), basic(RING_COLORS[i], 0.75));
      for (const m of [fill, edge]) { m.rotation.x = -Math.PI / 2; m.position.set(hx, ground + 0.5, hz); m.scale.setScalar(0.001); m.renderOrder = 4; group.add(m); }
      const c = chip(`${icon('footprints', 13)}${r.min} min walk`, 'ring');
      c.el.style.setProperty('--c', '#' + RING_COLORS[i].toString(16).padStart(6, '0'));
      c.ringR = r.radiusM;
      const ci = P.guided ? rings.length - 1 - i : i;
      fill.material.color.setHex(RING_COLORS[ci]); edge.material.color.setHex(RING_COLORS[ci]); c.el.style.setProperty('--c', '#' + RING_COLORS[ci].toString(16).padStart(6, '0'));
      beat(P.ring(i), 'How far you can walk', `This ring is roughly ${/^(8|11|18)$/.test(String(r.min)) ? 'an' : 'a'} ${r.min} minute walk from the door. The times on each place follow the real streets.`);
      add(P.ring(i), 0.9, (k) => { fill.scale.setScalar(Math.max(0.001, k)); edge.scale.setScalar(Math.max(0.001, k)); c.on = k > 0.6; });
    });

    // 3. nearest places: pins, routes, time chips
    let n = 0;
    const b2 = world.bounds;
    for (const cat of PLACES) {
      const p = data?.places?.[cat]?.[0];
      if (!p) continue;
      const q = world.proj.toLocal(p.lat, p.lon);
      let px = q.x, pz = q.z, far = false;
      const d = Math.hypot(px - hx, pz - hz);
      const inside = px > b2.minX + 5 && px < b2.maxX - 5 && pz > b2.minZ + 5 && pz < b2.maxZ - 5;
      if (!inside || d > 1100) { // off the map: show it at the edge, in its direction
        const lim = Math.min(d, 520);
        px = hx + ((px - hx) / d) * lim; pz = hz + ((pz - hz) / d) * lim; far = true;
        px = Math.max(b2.minX + 8, Math.min(b2.maxX - 8, px)); pz = Math.max(b2.minZ + 8, Math.min(b2.maxZ - 8, pz));
      }
      const gy = world.heightAt(px, pz);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTexture(cat), depthTest: false, transparent: true, fog: false, toneMapped: false, sizeAttenuation: false }));
      sprite.renderOrder = 10;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 6), basic(new THREE.Color(CAT_COLOR[cat]), 0.9));
      stem.renderOrder = 9;
      // hidden until its step: a sprite that keeps its screen size is drawn at full scale (it
      // fills the screen) at the world origin until its animation places it
      sprite.visible = false; stem.visible = false; sprite.scale.set(0.0001, 0.0001, 1);
      sprite.position.set(px, -100000, pz); stem.position.set(px, -100000, pz); // and parked far below the map, out of any camera's view
      group.add(sprite, stem);
      const useWalk = p.walkMin <= 15;
      const c = chip(`${icon(PLACE_ICON[cat], 14)}<b>${useWalk ? p.walkMin + ' min walk' : p.driveMin + ' min drive'}</b><span>${p.name && p.name !== PLACE_LABEL[cat] ? p.name : PLACE_LABEL[cat]}${far ? ' →' : ''}</span>`, 'place');
      c.el.style.setProperty('--c', CAT_COLOR[cat]);
      c.cat = cat;
      const t0 = P.place(n);
      beat(t0, PLACE_LABEL[cat], `${p.name && p.name !== PLACE_LABEL[cat] ? p.name : 'The nearest ' + PLACE_LABEL[cat].toLowerCase()} is ${useWalk ? `${/^(8|11|18)$/.test(String(p.walkMin)) ? 'an' : 'a'} ${p.walkMin} minute walk` : `about ${/^(8|11|18)$/.test(String(p.driveMin)) ? 'an' : 'a'} ${p.driveMin} minute drive`}.`);
      // the route: along the streets when the place is on the map, straight otherwise
      let line = null;
      const makeLine = () => {
        let pts = [{ x: hx, z: hz }, { x: px, z: pz }];
        if (!far && d < 520) { try { pts = findPath(world, { x: hx, z: hz }, { x: px, z: pz }); } catch { /* straight */ } }
        else { const steps = 24; pts = Array.from({ length: steps + 1 }, (_, i) => ({ x: hx + ((px - hx) * i) / steps, z: hz + ((pz - hz) * i) / steps })); }
        line = ribbon(pts, new THREE.Color(CAT_COLOR[cat]));
        if (group) group.add(line);
      };
      setTimeout(() => { if (cur === l && group) makeLine(); }, 80 + n * 140); // one route search per few frames, so the frame rate holds
      add(t0, 0.7, (k) => {
        sprite.visible = true; stem.visible = true;
        const s = Math.max(0.001, k) * 0.052;
        sprite.scale.set(s, s, 1);
        const h = 13 * Math.min(1.15, k);
        sprite.position.set(px, gy + h, pz);
        stem.scale.set(1, Math.max(0.01, h - 4), 1);
        stem.position.set(px, gy + (h - 4) / 2, pz);
        c.pos.set(px, gy + h + 5.5, pz); c.on = k > 0.5;
      });
      add(t0 + 0.1, 0.9, (k) => { if (line) line.geometry.setDrawRange(0, Math.floor((line.userData.count * k) / 3) * 3); }, smooth);
      n++;
    }

    // 4. solar: panels drop onto the roof
    const solar = data?.solar;
    if (b && solar?.panels) {
      const tiles = layoutPanels(b, Math.min(solar.panels, 44));
      if (tiles.length) {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 0.08, 1.72), new THREE.MeshBasicMaterial({ color: 0x2f7bff, toneMapped: false, fog: false }), tiles.length);
        mesh.renderOrder = 7; mesh.frustumCulled = false;
        const dm = new THREE.Object3D();
        group.add(mesh);
        const place = (i, k) => {
          const t = tiles[i];
          dm.position.set(t.x, top + 0.35 + (1 - k) * 14, t.z); dm.rotation.set(0, -t.a, 0); dm.scale.setScalar(k <= 0 ? 0.001 : 1); dm.updateMatrix();
          mesh.setMatrixAt(i, dm.matrix);
        };
        tiles.forEach((_, i) => place(i, 0));
        beat(P.solar, 'The roof', `It fits about ${solar.panels} solar panels, which could save an estimated $${solar.savingsYear.toLocaleString('en-US')} a year.`);
        tiles.forEach((_, i) => add(P.solar + i * 0.022, 0.42, (k) => { place(i, Math.min(1, k)); mesh.instanceMatrix.needsUpdate = true; }, (k) => 1 - (1 - k) * (1 - k)));
        const c = chip(`${icon('sun', 15)}<b>about $${solar.savingsYear.toLocaleString('en-US')} a year</b><span>Solar estimate</span>`, 'solar');
        c.pos.set(hx, top + 9, hz);
        add(P.solar + 0.3, 0.5, (k) => { c.on = k > 0.3; });
      }
    } else if (data?.aerial?.solar) {
      const c = chip(`${icon('sun', 15)}<b>Solar panels on the roof</b><span>Seen from the air</span>`, 'solar');
      c.pos.set(hx, top + 9, hz);
      beat(P.solar, 'The roof', 'Solar panels are already on the roof, seen from the air.');
      add(P.solar + 0.1, 0.4, (k) => { c.on = k > 0.3; });
    }

    // 5. flood zone: a gentle blue ripple
    if (data?.risk?.flood?.sfha) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(150, 64), basic(0x2f7bff, 0));
      water.rotation.x = -Math.PI / 2; water.position.set(hx, ground + 0.6, hz); water.renderOrder = 5;
      group.add(water);
      group.userData.water = water;
      const c = chip(`${icon('waves', 14)}<b>${data.risk.flood.label}</b><span>FEMA flood map</span>`, 'flood');
      c.pos.set(hx - 60, ground + 4, hz + 60);
      beat(P.flood, 'Flood zone', `${data.risk.flood.label}. A lender will likely require flood insurance.`);
      add(P.flood, 0.9, (k) => { water.material.opacity = 0.22 * k; c.on = k > 0.4; }, smooth);
    }
    // 6. the costs of owning it: insurance, HOA, amenities, tax (guided pace only)
    if (P.guided && P.nFacts) extraFacts(data).filter((x) => x.key !== 'energy' && !(x.key === 'risk' && data?.risk?.flood?.sfha)).slice(0, P.nFacts).forEach((x, i) => beat(P.fact(i), x.title, x.text));
    // a little dimmer, so the highlights read
    baseExposure = 1;
    add(0.1, 1.0, (k) => { ctx.env.setDim(1 - 0.2 * k); }, smooth);
    beat(P.panel, 'The details', 'Price against similar homes, the true monthly cost, energy, risk and more are on the right. Every card has an i for its source.');
    add(P.panel, 0.1, () => { if (stage < 2) { stage = 2; ctx.emit('reveal-panel', l, data); } }, smooth);
    add(P.end + 2.5, 0.05, () => capEl.classList.remove('show'), smooth);
  }

  // rows of panels inside the roof outline, aligned with the building's longest wall
  function layoutPanels(b, count) {
    const pts = b.pts;
    let a = 0, best = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const len = Math.hypot(q.x - p.x, q.y - p.y); if (len > best) { best = len; a = Math.atan2(q.y - p.y, q.x - p.x); } }
    const ca = Math.cos(a), sa = Math.sin(a), out = [];
    const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    for (let u = -R; u <= R; u += 1.2) for (let w = -R; w <= R; w += 1.9) {
      const x = b.cx + u * ca - w * sa, z = b.cz + u * sa + w * ca;
      let ok = true;
      for (const [du, dw] of [[-0.9, -1.2], [0.9, -1.2], [0.9, 1.2], [-0.9, 1.2]]) if (!pointIn(pts, x + du * ca - dw * sa, z + du * sa + dw * ca)) { ok = false; break; }
      if (ok) out.push({ x, z, a, d: Math.hypot(u, w) });
    }
    return out.sort((p, q) => p.d - q.d).slice(0, count);
  }

  function teardown() {
    if (group) {
      ctx.scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.map) o.material.dispose(); else if (o.material) o.material.dispose(); });
      group = null;
    }
    for (const c of chips) c.el.remove();
    chips = []; anims = []; capEl.classList.remove('show');
    if (baseExposure != null) { ctx.env.setDim(1); baseExposure = null; }
  }

  async function select(l, opts = {}) {
    if (!l || !ctx.world || ctx.state !== 'play') return false;
    if (cur === l) { if (opts.replay) replay(); return true; }
    const my = ++token;
    teardown();
    cur = l; ins = null; T = 0; stage = 1; zoom = 1;
    angle = Math.atan2(ctx.cam.pos.x - (l.building ? l.building.cx : l.x), ctx.cam.pos.z - (l.building ? l.building.cz : l.z));
    ctx.cam.setMode('free');
    ctx.audio.whoosh?.();
    ctx.emit('select', l);
    ctx.hud.interiorStills(l).then((st) => { if (st[0]) { const im = new Image(); im.src = ctx.world.base + st[0]; } }).catch(() => {});
    const data = await ctx.insights.get(l.id);
    if (my !== token || cur !== l) return false;
    ins = data;
    build(l, data);
    if (opts.instant || reduced()) T = 99;
    window.__gpa.reveal = { id: l.id, stage: 1, hasInsights: !!data };
    return true;
  }
  function replay() { if (!cur) return; const l = cur, d = ins; teardown(); T = 0; stage = 2; build(l, d); }
  function skip() { if (cur) { T = Math.max(T, 99); capEl.classList.remove('show'); } }
  // jump to the next step of the story
  function nextBeat() { if (!cur) return; const nx = beats.find((t) => t > T + 0.05); if (nx == null) skip(); else T = nx; }
  function close() {
    if (!cur) return;
    token++;
    const l = cur;
    teardown();
    cur = null; ins = null; stage = 0;
    if (ctx.cam.mode === 'free') ctx.cam.setMode('chase');
    window.__gpa.reveal = null;
    ctx.emit('select', null, l);
  }

  ctx.on('update', (dt) => {
    if (!cur || !home) return;
    if (ctx.state === 'tour') return;
    T += dt;
    for (const a of anims) {
      if (a.done || T < a.t0) continue;
      const k = Math.min(1, (T - a.t0) / a.dur);
      a.fn(a.ease(k));
      if (k >= 1) a.done = true;
    }
    if (stage === 2 && T > (P ? P.end : 4.2)) { stage = 3; if (window.__gpa.reveal) window.__gpa.reveal.stage = 3; ctx.emit('reveal-done', cur, ins); }
    else if (window.__gpa.reveal) window.__gpa.reveal.stage = stage;
    const w = group?.userData;
    if (w?.walls) w.walls.material.opacity = (w.walls.userData.o || 0) * (0.75 + 0.25 * Math.sin(T * 3));
    if (w?.water) w.water.scale.setScalar(1 + 0.05 * Math.sin(T * 1.6));
    // drone camera: a slow orbit, the home a little left of center (the panel is on the right)
    if (ctx.cam.mode === 'free') {
      angle += dt * (reduced() ? 0 : 0.045);
      // close on the home first, pull out wide while the rings and places arrive, then settle
      // at a middle distance; the mouse wheel zooms
      const cl = (v) => Math.max(0, Math.min(1, v));
      const wi = P ? P.wideIn : 0.9, wo = P ? P.wideOut : 3.3;
      const wide = smooth(cl((T - wi) / 0.9)) * (1 - smooth(cl((T - wo) / 1.1)));
      const rest = smooth(cl((T - wo) / 1.1));
      const closeR = Math.max(74, home.size * 2.0), closeH = Math.max(58, home.size * 1.3);
      const mix = (a, b, k) => a + (b - a) * k;
      const R = mix(mix(closeR, Math.max(150, closeR * 1.6), rest), 330, wide) * zoom;
      const H = mix(mix(closeH, Math.max(140, closeH * 1.7), rest), 360, wide) * zoom + (home.top - home.ground) * 0.6;
      want.set(home.x + Math.sin(angle) * R, home.ground + H, home.z + Math.cos(angle) * R);
      const rx = Math.cos(angle), rz = -Math.sin(angle);
      wantLook.set(home.x + rx * R * 0.2, home.ground + (home.top - home.ground) * 0.5, home.z + rz * R * 0.2);
      const k = 1 - Math.exp(-dt * 3.4);
      ctx.cam.pos.lerp(want, k);
      ctx.cam.look.lerp(wantLook, 1 - Math.exp(-dt * 5));
    }
  });
  // labels follow their 3D points
  ctx.on('post', () => {
    if (!cur || !chips.length) return;
    const cam = ctx.camera, W = innerWidth, H = innerHeight, placed = [];
    for (const c of chips) {
      if (c.ringR) {
        const rx = Math.cos(angle), rz = -Math.sin(angle);
        c.pos.set(home.x - rx * c.ringR * 0.72 + Math.sin(angle) * c.ringR * 0.69, home.ground + 1, home.z - rz * c.ringR * 0.72 + Math.cos(angle) * c.ringR * 0.69);
      }
      v3.copy(c.pos).project(cam);
      let x = ((v3.x + 1) / 2) * W, y = ((1 - v3.y) / 2) * H;
      const behind = v3.z > 1;
      let vis = c.on && !behind && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      if (c.cat && c.on) { // a place off screen keeps its chip at the edge, in its direction
        if (behind) { x = W - x; y = H * 1.5; }
        const x0 = 140, x1 = W - (ctx.panel?.el.classList.contains('show') ? ctx.panel.el.offsetWidth + 120 : 110), y0 = 96, y1 = H - 150;
        let cx = Math.max(x0, Math.min(x1, x));
        const cy = Math.max(y0, Math.min(y1, y));
        if (cy > H - 260 && cx < 340) cx = 340;
        c.el.classList.toggle('edge', cx !== x || cy !== y);
        x = cx; y = cy; vis = true;
        for (let guard = 0; guard < 8 && placed.some((p) => Math.abs(p.x - x) < 210 && Math.abs(p.y - y) < 30); guard++) y += 31;
        placed.push({ x, y });
      }
      c.el.classList.toggle('on', vis);
      if (vis) c.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
    // edge chips stack instead of covering each other
  });

  // ---- ways to select
  let downAt = null;
  const canvas = ctx.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6 || ctx.state !== 'play' || ctx.hud.choosing) return;
    if (ctx.buyer?.pinning) { ctx.buyer.pinAtScreen(e.clientX, e.clientY); return; }
    const hit = pick(e.clientX, e.clientY);
    if (hit) select(hit);
  });
  function pick(sx, sy) {
    let best = null, bd = 38;
    for (const it of ctx.listingsSys.items) {
      if (!ctx.listingsSys.visible[it.l.kind]) continue;
      for (const y of [it.top + 4.5 * it.size, it.top]) {
        v3.set(it.x, y, it.z).project(ctx.camera);
        if (v3.z > 1) continue;
        const d = Math.hypot(((v3.x + 1) / 2) * innerWidth - sx, ((1 - v3.y) / 2) * innerHeight - sy);
        if (d < bd) { bd = d; best = it.l; }
      }
    }
    return best;
  }
  canvas.addEventListener('wheel', (e) => { if (cur && ctx.state === 'play') { zoom = Math.max(0.45, Math.min(3.2, zoom * (e.deltaY > 0 ? 1.12 : 0.89))); e.preventDefault(); } }, { passive: false });
  let hover = null;
  canvas.addEventListener('pointermove', (e) => {
    if (ctx.state !== 'play' || e.buttons) return;
    const h = pick(e.clientX, e.clientY);
    if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : ''; ctx.emit('hover-listing', h); if (h) ctx.insights.preload(h.id); }
  });
  const mini = document.getElementById('minimap');
  if (mini) {
    mini.classList.add('clickable');
    mini.addEventListener('click', (e) => {
      if (ctx.state !== 'play' || !ctx.world) return;
      const r = mini.getBoundingClientRect(), s = ctx.car.state;
      const m = 300 / r.width, sx = (e.clientX - r.left - r.width / 2) * m, sy = (e.clientY - r.top - r.height / 2) * m;
      const c = Math.cos(s.heading), sn = Math.sin(s.heading);
      const wx = s.x + sx * c + sy * sn, wz = s.z - sx * sn + sy * c;
      let best = null, bd = 34;
      for (const l of ctx.world.listings) { const d = Math.hypot((l.mx ?? l.x) - wx, (l.mz ?? l.z) - wz); if (d < bd && ctx.listingsSys.visible[l.kind]) { bd = d; best = l; } }
      if (best) select(best);
    });
  }
  ctx.on('key', (code, e) => {
    if (ctx.state !== 'play' || ctx.hud.choosing) return;
    if (code === 'KeyE') { const l = ctx.listingsSys.near; if (l && cur !== l) select(l); }
    else if (code === 'Space' && cur && stage < 3) { if (P?.guided && !e?.shiftKey) nextBeat(); else skip(); }
    else if (code === 'Escape' && cur) close();
    else if (cur && /^(KeyW|KeyS|ArrowUp|ArrowDown)$/.test(code) && !ctx.input.auto.active) close(); // drive away
  });
  ctx.on('near-listing', (l) => { if (l) ctx.insights.preload(l.id); });
  ctx.on('tour-enter', () => { if (cur) { for (const c of chips) c.el.classList.remove('on'); if (group) group.visible = false; } });
  ctx.on('tour-exit', () => { if (cur && group) { group.visible = true; ctx.cam.setMode('free'); } });
  ctx.on('city-unload', () => { token++; teardown(); cur = null; ins = null; stage = 0; if (ctx.cam.mode === 'free') ctx.cam.setMode('chase'); ctx.emit('select', null); });

  window.__gpa.select = (id, instant) => select(ctx.world.listings.find((l) => l.id === String(id)) || ctx.world.listings[0], { instant });
  return {
    select, close, replay, skip,
    get listing() { return cur; },
    get insights() { return ins; },
    get open() { return !!cur; },
    get stage() { return stage; },
    isOpenFor: (l) => !!l && cur === l,
    setSunTime(v) { sunTime = v; },
    get sunTime() { return sunTime; },
    get home() { return home; },
  };
}
