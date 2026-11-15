// The property reveal: select a home (click its marker, click the minimap, pull up and press
// E, or from a mission) and the world shows what living there is like. The camera rises to a
// drone view, walk time rings grow from the home, the nearest places pop up with routes and
// times, solar panels drop onto the roof, a flood zone ripples in blue, and the insight panel
// slides in. Every number comes from the home's insight file.
//
// Maya tells it. Each thing appears as she starts its line, the map waits until she has
// finished the sentence, and a large caption shows the number she is talking about, its words
// lighting up as she says them. The panel then opens one card at a time, each with its own
// line, instead of all at once. Her words are different every time (src/revealScript.js,
// src/voiceLines.js). Space moves to the next step, Shift+Space jumps to the end. "Quick" in
// the settings is the short silent version.
import * as THREE from 'three';
import { findPath } from './nav.js';
import { iconUrl, icon, PLACE_ICON, PLACE_LABEL } from './icons.js';
import { SCORE_COLOR } from './panel.js';
import { costFor } from './costmath.js';
import { MAYA_AVATAR } from './maya.js';
import { makeFlow } from './lines.js';
import { homeStep, walkStep, placeStep, roofStep, floodStep, panelSteps } from './revealScript.js';

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
  // each nearest place in turn, the roof, any flood zone, then the panel card by card.
  // In the guided pace the times below only space the steps far enough apart for their own
  // animations: how long a step really lasts is how long Maya takes to say its line (the hold
  // in the update loop). "Quick" keeps the short silent version.
  let P = null;
  const guided = () => (ctx.params.get('pace') || ctx.settings?.revealPace || 'guided') !== 'quick';
  function plan(data, told, nCards = 0) {
    const nPlaces = PLACES.filter((c) => data?.places?.[c]?.[0]).length;
    const nRings = (data?.rings?.walk || []).length;
    const solar = !!(data?.solar?.panels || data?.aerial?.solar), flood = !!data?.risk?.flood?.sfha;
    if (!told) return { outline: 0.5, ring: (i) => 1.0 + i * 0.32, place: (n) => 1.9 + n * 0.16, solar: 2.9, flood: 3.2, panel: 2.5, card: () => 2.5, end: 4.2, wideIn: 0.9, wideOut: 3.3, guided: false };
    const ring0 = 1.5, ringGap = 0.55, place0 = ring0 + (nRings ? (nRings - 1) * ringGap + 1.25 : 0.1), gap = 1.0;
    const solarT = place0 + nPlaces * gap + 0.2, floodT = solarT + (solar ? 1.6 : 0), panelT = floodT + (flood ? 1.2 : 0) + 0.2;
    return { outline: 0.5, ring: (i) => ring0 + i * ringGap, place: (n) => place0 + n * gap, solar: solarT, flood: floodT, panel: panelT, card: (n) => panelT + n * 0.5, end: panelT + Math.max(1, nCards) * 0.5 + 0.5, wideIn: ring0 - 0.4, wideOut: solarT - 0.5, guided: true };
  }

  // ---- the story Maya tells
  // N holds it while it runs: the steps in order, which one she is on, and whether she has
  // finished its line (free), which is what lets the map move on to the next step.
  let N = null, prep = null, prepTimer = 0;
  const capEl = document.createElement('div');
  capEl.id = 'reveal-cap';
  capEl.setAttribute('aria-live', 'polite');
  ctx.hud.root.append(capEl);
  const esc = ctx.hud.esc;
  // every step of the story for one home, with a stock line each (src/revealScript.js)
  function script(l, data) {
    const ms = ctx.maya?.state, row = ctx.insights.row(l.id), flow = makeFlow();
    const out = [homeStep(l, data, row, !!ms && !ms.introduced)];
    out[0].intro = !!ms && !ms.introduced;
    const rings = data?.rings?.walk || [];
    if (rings.length) out.push(walkStep(rings));
    let k = 0;
    for (const cat of PLACES) { const p = data?.places?.[cat]?.[0]; if (p) out.push(placeStep(cat, p, k++, flow)); }
    const roof = roofStep(data?.solar, data?.aerial);
    if (roof) out.push(roof);
    if (data?.risk?.flood?.sfha) out.push(floodStep(data.risk.flood));
    const down = ctx.panel?.options.downPct ?? 20;
    out.push(...panelSteps(data, row, data?.cost ? costFor(data, { downPct: down, solarOn: false }) : null, down, flow));
    return out;
  }
  // Parked next to a home for a moment: have the story and Maya's own wording for it ready, so
  // she starts the instant the home is selected.
  async function prepare(l) {
    if (prep && prep.l === l && performance.now() - prep.at < 120000) return prep;
    const data = await ctx.insights.get(l.id);
    if (!data || ctx.listingsSys.near !== l || cur) return null;
    const steps = script(l, data);
    const p = { l, at: performance.now(), steps, lines: ctx.voiceLines?.request('reveal', steps, { intro: steps[0].intro }) || null };
    prep = p;
    // her opening line's voice is on its way too: in her own words if they come within a second
    const first = () => {
      const st = steps[0];
      if (prep !== p || st.text) return;
      const m = p.lines?.get(st.key);
      st.text = m || st.stock; st.source = m ? 'model' : 'script';
      ctx.maya?.preload?.(st.text);
    };
    if (p.lines?.live) { const t0 = performance.now(), t = setInterval(() => { if (prep !== p || p.lines.has('home') || performance.now() - t0 > 1300) { clearInterval(t); first(); } }, 80); } else first();
    return p;
  }
  const commit = (st) => { if (!st.text) { const m = N?.lines?.get(st.key); st.text = m || st.stock; st.source = m ? 'model' : 'script'; } return st.text; };
  function hideCap() { capEl.classList.remove('show', 'talking'); document.body.classList.remove('narrating'); }
  let words = [], mouth = null;
  function showStep(i) {
    const st = N.steps[i];
    // a figure that is a number reads large; one that is words (a rating, "Amenities") a little smaller
    const wordy = !/\d/.test(st.figure || '') || String(st.figure).length > 12;
    capEl.innerHTML = `<span class="rn-ava">${MAYA_AVATAR}<i class="rn-wave"></i></span><div class="rn-body">
      <div class="rn-top"><b>${icon(st.icon || 'sparkles', 16)}${esc(st.title)}</b><span class="rn-count">${i + 1} of ${N.steps.length}</span><span class="rn-dots" aria-hidden="true">${N.steps.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</span></div>
      <div class="rn-fig${wordy ? ' wordy' : ''}"><strong>${esc(st.figure)}</strong>${st.unit ? `<em>${esc(st.unit)}</em>` : ''}</div>
      ${st.sub ? `<small class="rn-sub">${esc(st.sub)}</small>` : ''}
      <p class="rn-line">${st.text.split(/\s+/).map((w) => `<span>${esc(w)}</span>`).join(' ')}</p>
      <div class="rn-keys"><span><kbd>Space</kbd> next</span><span><kbd>Shift</kbd> <kbd>Space</kbd> skip</span><button class="linkbtn" data-skip>Skip to the end</button></div></div>`;
    capEl.classList.add('show');
    capEl.style.setProperty('--rc', st.card ? SCORE_COLOR[st.card] || '#ffc940' : st.cat ? CAT_COLOR[st.cat] : '#ffc940');
    document.body.classList.add('narrating');
    capEl.querySelector('[data-skip]').addEventListener('click', () => skip());
    words = [...capEl.querySelectorAll('.rn-line span')];
    mouth = capEl.querySelector('.mouth');
    N.lit = 0;
  }
  // the words of the line light up as she says them: an even pace over the time she speaks,
  // all of them once she is done
  function lightWords(dt) {
    if (!words.length) return;
    const speaking = !!ctx.maya?.speaking;
    capEl.classList.toggle('talking', speaking);
    if (mouth) mouth.setAttribute('ry', (2 + (ctx.maya?.level?.() || 0) * 8).toFixed(1));
    let n;
    if (N.free) n = words.length;
    else if (N.heard || speaking) { N.spoke += speaking ? dt : 0; n = Math.min(words.length - 1, Math.floor(N.spoke * 2.7) + 1); }
    else if (!ctx.maya || ctx.maya.state?.state === 'idle') { N.spoke += dt; n = Math.min(words.length, Math.floor((N.spoke / N.read) * words.length) + 1); }
    else n = 0;
    if (n > N.lit) { for (let k = N.lit; k < n; k++) words[k].classList.add('lit'); N.lit = n; }
  }
  // the panel part of the story: the panel opens without its cards, and each card comes in as
  // she starts its line
  let told = false;
  function openPanel(narrated) {
    if (stage >= 2 || !cur) return;
    stage = 2;
    told = narrated;
    ctx.emit('reveal-panel', cur, ins, { narrated });
  }
  // a step begins: its caption comes up and Maya starts its line
  function enter(i) {
    // the timeline calls a step's start on each frame of its short window: start it once
    if (!N || !N.steps[i] || N.i === i) return;
    const st = N.steps[i];
    N.i = i; N.free = false; N.heard = false; N.gap = 0; N.el = 0; N.spoke = 0;
    commit(st);
    N.read = Math.max(1.6, st.text.length * 0.055); // time to read it when there is no voice
    if (st.intro && ctx.maya?.state) ctx.maya.state.introduced = true;
    showStep(i);
    if (st.card || st.key === 'rest') openPanel(true);
    if (st.card) ctx.panel?.focus(st.card);
    if (st.key === 'rest') ctx.panel?.revealAll();
    ctx.maya?.say(st.text, { caption: false });
    ctx.voiceLines?.remember(st.text);
    for (const c of chips) c.el.classList.toggle('now', !!c.step && c.step === st.key);
    // the next line is settled now, and its voice asked for, so there is no pause between steps
    const nx = N.steps[i + 1];
    if (nx) ctx.maya?.preload?.(commit(nx));
    window.__gpa.revealStep = { i: i + 1, n: N.steps.length, title: st.title, key: st.key, text: st.text, source: st.source };
  }
  // the hold: the timeline stops just short of the next step until she has said this one
  function hold(dt) {
    const ms = ctx.maya?.state?.state;
    if (ms === 'listening' || ms === 'thinking') { endStory(false); return; } // the player is talking to her: the story steps aside
    if (N.i >= 0 && !N.free) {
      N.el += dt;
      if (ctx.maya?.speaking) { N.heard = true; N.gap = 0; } else N.gap += dt;
      if (N.heard ? N.gap > 0.3 && N.el > 0.9 : N.el > N.read) N.free = true;
    }
    if (N.i >= 0) lightWords(dt);
    const nx = N.steps[N.i + 1];
    const limit = (nx ? nx.t : P.end) - 0.03;
    if (!N.free && T > limit) T = limit;
  }
  // the story is over (told to the end, skipped, or interrupted): everything is shown at once
  function endStory(hush = true) {
    if (!N) return;
    if (hush) ctx.maya?.interrupt();
    N.lines?.cancel();
    N = null;
    T = Math.max(T, 99);
    hideCap();
    for (const c of chips) c.el.classList.remove('now');
    if (told) ctx.panel?.revealAll();
  }

  // told: Maya tells the story step by step. ready: a story prepared while the car was parked here.
  function build(l, data, { told: tell = false, ready = null } = {}) {
    N = null; told = false;
    const story = tell ? { steps: [], i: -1, free: true, heard: false, gap: 0, el: 0, read: 2, spoke: 0, lit: 0, lines: null } : null;
    const all = story ? ready?.steps || script(l, data) : [];
    const lines = story ? new Map(all.map((s) => [s.key, s])) : null;
    const cards = all.filter((s) => s.card || s.key === 'rest');
    P = plan(data, tell, cards.length);
    // a step of the story begins at t on the timeline (only steps that have something to show are told)
    const step = (t, key) => { const st = lines?.get(key); if (!st || st.t != null) return; st.t = t; story.steps.push(st); add(t, 0.05, () => enter(story.steps.indexOf(st)), smooth); };
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

    step(0.2, 'home');
    // 2. walk time rings: 5, 10, 15 minutes, growing outward one after another
    const rings = [...(data?.rings?.walk || [])].sort((a, c) => (P.guided ? a.min - c.min : c.min - a.min));
    rings.forEach((r, i) => {
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r.radiusM, 72), basic(RING_COLORS[i], 0.1));
      const edge = new THREE.Mesh(new THREE.RingGeometry(r.radiusM - 1.6, r.radiusM, 96), basic(RING_COLORS[i], 0.75));
      for (const m of [fill, edge]) { m.rotation.x = -Math.PI / 2; m.position.set(hx, ground + 0.5, hz); m.scale.setScalar(0.001); m.renderOrder = 4; group.add(m); }
      const c = chip(`${icon('footprints', 13)}${r.min} min walk`, 'ring');
      c.el.style.setProperty('--c', '#' + RING_COLORS[i].toString(16).padStart(6, '0'));
      c.ringR = r.radiusM;
      c.step = 'walk';
      const ci = P.guided ? rings.length - 1 - i : i;
      fill.material.color.setHex(RING_COLORS[ci]); edge.material.color.setHex(RING_COLORS[ci]); c.el.style.setProperty('--c', '#' + RING_COLORS[ci].toString(16).padStart(6, '0'));
      if (i === 0) step(P.ring(0), 'walk'); // one line for the rings: they grow one after another while she says it
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
      c.step = `place_${cat}`;
      const t0 = P.place(n);
      step(t0, `place_${cat}`);
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
        step(P.solar, 'roof');
        tiles.forEach((_, i) => add(P.solar + i * 0.022, 0.42, (k) => { place(i, Math.min(1, k)); mesh.instanceMatrix.needsUpdate = true; }, (k) => 1 - (1 - k) * (1 - k)));
        const c = chip(`${icon('sun', 15)}<b>about $${solar.savingsYear.toLocaleString('en-US')} a year</b><span>Solar estimate</span>`, 'solar');
        c.pos.set(hx, top + 9, hz);
        c.step = 'roof';
        add(P.solar + 0.3, 0.5, (k) => { c.on = k > 0.3; });
      }
    } else if (data?.aerial?.solar) {
      const c = chip(`${icon('sun', 15)}<b>Solar panels on the roof</b><span>Seen from the air</span>`, 'solar');
      c.pos.set(hx, top + 9, hz);
      c.step = 'roof';
      step(P.solar, 'roof');
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
      c.step = 'flood';
      step(P.flood, 'flood');
      add(P.flood, 0.9, (k) => { water.material.opacity = 0.22 * k; c.on = k > 0.4; }, smooth);
    }
    // 6. the panel: told card by card (price and value, the monthly cost, energy, risk, HOA, then
    // the rest of the cards together), or all at once in the quick pace
    cards.forEach((st, i) => step(P.card(i), st.key));
    // a little dimmer, so the highlights read
    baseExposure = 1;
    add(0.1, 1.0, (k) => { ctx.env.setDim(1 - 0.2 * k); }, smooth);
    // the panel opens here at the latest (with the story skipped or over, all its cards at once)
    add(P.panel, 0.1, () => openPanel(!!N && cards.length > 0), smooth);
    add(P.end + 2.6, 0.05, () => { if (N) { N = null; for (const c of chips) c.el.classList.remove('now'); } hideCap(); }, smooth);
    if (story) {
      // steps were added as the map was built: tell them in the order they appear
      story.steps.sort((a, c) => a.t - c.t);
      N = story;
      // her own wording for every line, asked for once (or already on its way from the car)
      story.lines = ready?.lines || ctx.voiceLines?.request('reveal', story.steps, { intro: story.steps[0]?.intro }) || null;
      if (story.steps[0]) ctx.maya?.preload?.(commit(story.steps[0]));
      ctx.hud.caption('');           // a line from the drive does not sit over her caption
      ctx.emit('narration', true);   // the first run tutorial steps aside
    }
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
    chips = []; anims = [];
    if (N) { N.lines?.cancel(); N = null; }
    hideCap();
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
    // Maya tells it unless the reveal is instant (a hop between homes, reduced motion) or quick
    const quiet = !!opts.instant || reduced();
    const ready = prep && prep.l === l && performance.now() - prep.at < 120000 ? prep : null;
    prep = null;
    build(l, data, { told: guided() && !quiet, ready });
    if (quiet) T = 99;
    window.__gpa.reveal = { id: l.id, stage: 1, hasInsights: !!data };
    return true;
  }
  function replay() { if (!cur) return; const l = cur, d = ins; if (N) ctx.maya?.interrupt(); teardown(); T = 0; stage = 1; build(l, d, { told: guided() && !reduced() }); }
  function skip() { if (!cur) return; if (N) endStory(); else { T = Math.max(T, 99); hideCap(); } }
  // on to the next step of the story: she drops the line she is on and starts the next
  function nextBeat() {
    if (!cur || !N) return skip();
    const nx = N.steps[N.i + 1];
    if (!nx) return skip();
    ctx.maya?.interrupt();
    N.free = true;
    T = Math.max(T, nx.t);
  }
  function close() {
    if (!cur) return;
    token++;
    const l = cur;
    if (N) ctx.maya?.interrupt();
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
    if (N) hold(dt);
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
    const capBottom = capEl.classList.contains('show') ? capEl.getBoundingClientRect().bottom : 0;
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
        // the frame the chips stay in: clear of the dock and the step caption at the top, the
        // panel on the right, and the minimap, its key and Maya along the bottom
        const x0 = 140, x1 = W - (ctx.panel?.el.classList.contains('show') ? ctx.panel.el.offsetWidth + 120 : 110);
        const y0 = capBottom ? capBottom + 44 : 132, y1 = H - 168;
        let cx = Math.max(x0, Math.min(x1, x));
        const cy = Math.max(y0, Math.min(y1, y));
        if (cy > H - 262 && cx < 348) cx = 348;
        c.el.classList.toggle('edge', cx !== x || cy !== y);
        x = cx; y = cy; vis = true;
        // chips that would cover each other stack: upward in the lower half, downward above it
        const dir = y > H / 2 ? -31 : 31;
        for (let guard = 0; guard < 8 && placed.some((p) => Math.abs(p.x - x) < 210 && Math.abs(p.y - y) < 30); guard++) y += dir;
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
  ctx.on('near-listing', (l) => {
    if (l) ctx.insights.preload(l.id);
    // parked here for a moment: get her lines for this home ready before it is selected
    clearTimeout(prepTimer);
    if (l && guided() && !reduced()) prepTimer = setTimeout(() => { if (ctx.listingsSys.near === l && !cur) prepare(l).catch(() => {}); }, 900);
  });
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
