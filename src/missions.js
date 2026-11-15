// Voice missions: score every listing against the spoken filters, light up the top five,
// pick the best and guide the player there with a glowing ribbon on the ground and an arrow
// at the top of the screen. Narrates on arrival. Never a chat window.
import { pick } from './lines.js';
import * as THREE from 'three';
import { EMPTY_FILTERS, describe, narrate, parseMission } from './parser.js';
import { findPath, pathLength } from './nav.js';
import { priceValue } from './format.js';

const NEAR_OK = 600; // meters that count as "near"

function featureText(l) {
  if (!l._text) {
    const parts = [...(l.highlights || []), ...Object.values(l.features || {}).flat(), l.summary || ''];
    l._text = parts.join(' | ').toLowerCase();
  }
  return l._text;
}
const FEATURE_WORDS = {
  garage: ['garage'], fireplace: ['fireplace'], 'island kitchen': ['island'], hardwood: ['hardwood', 'wood floor'], yard: ['yard', 'backyard', 'garden'],
  office: ['office', 'study'], patio: ['patio', 'deck', 'porch'], balcony: ['balcony'], view: ['view'], new: ['new construction', 'newly built', 'brand new'],
  schools: ['school'], gym: ['gym', 'fitness'], 'walk in closet': ['walk-in', 'walk in'], solar: ['solar'], gated: ['gated'], elevator: ['elevator'],
  pet: ['pet', 'dog'], washer: ['washer', 'laundry'], 'open floor plan': ['open floor', 'open concept'],
};
function hasFeature(l, name) {
  if (name === 'solar' && l.vexcel?.solar) return true;
  if (name === 'new' && l.yearBuilt >= 2024) return true;
  const text = featureText(l);
  return (FEATURE_WORDS[name] || [name]).some((w) => text.includes(w));
}

export function initMissions(ctx) {
  const M = {
    filters: { ...EMPTY_FILTERS, features: [] }, near: [], active: false, target: null, top: [], route: null,
    last: null, lastRated: null, visited: new Set(), similar: null, narrated: new Set(), prefetch: new Map(), extraNear: {},
    routeAge: 0, arrived: false, seed: 0,
  };
  let ribbon = null;
  const ribbonMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { t: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float t;
      void main(){ float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        float chev = fract(vUv.y * 0.22 - t * 1.6 + abs(vUv.x - 0.5) * 0.9);
        float glow = 0.45 + 0.55 * smoothstep(0.55, 1.0, chev);
        gl_FragColor = vec4(mix(vec3(1.0, 0.62, 0.1), vec3(1.0, 0.92, 0.45), glow), edge * (0.5 + 0.45 * glow)); }`,
  });

  function clearRibbon() {
    if (ribbon) { ribbon.parent?.remove(ribbon); ribbon.geometry.dispose(); ribbon = null; }
  }
  function buildRibbon(pts) {
    clearRibbon();
    if (!pts || pts.length < 2) return;
    const w = 1.5, pos = [], uv = [], idx = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      if (i) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const y = ctx.world.heightAt(pts[i].x, pts[i].z) + 0.35;
      pos.push(pts[i].x - dz * w, y, pts[i].z + dx * w, pts[i].x + dz * w, y, pts[i].z - dx * w);
      uv.push(0, dist, 1, dist);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    ribbon = new THREE.Mesh(g, ribbonMat);
    ribbon.renderOrder = 3;
    ribbon.frustumCulled = false;
    ctx.world.group.add(ribbon);
  }

  // ---------------------------------------------------------------- scoring
  function nearDist(l, word) {
    if (l.nearby && l.nearby[word] != null) return l.nearby[word];
    const tiles = M.extraNear[word] || ctx.world.nearby[word];
    if (!tiles || !tiles.length) return null;
    let best = Infinity;
    for (const t of tiles.slice(0, 15)) {
      const q = ctx.world.proj.toLocal(t.lat, t.lon);
      best = Math.min(best, Math.hypot(q.x - l.x, q.z - l.z));
    }
    return best;
  }

  function evaluate(l, f, near) {
    let miss = 0, score = 0;
    const isRentKind = l.kind === 'rent' || l.kind === 'apartments' || (l.kind === 'sold' && l.price == null);
    if (f.kind) { if (l.kind !== f.kind) miss += 3; } else if (l.kind === 'sold') miss += 0.6; // recently sold only when asked for
    const wantsRent = f.minRent != null || f.maxRent != null;
    const wantsPrice = f.minPrice != null || f.maxPrice != null;
    if (wantsRent && !isRentKind) miss += 3;
    if (wantsPrice && (isRentKind || l.price == null)) miss += 3;
    const price = l.price, rent = l.rent;
    if (f.maxPrice != null && price != null) { if (price > f.maxPrice) miss += 1 + Math.min(2, (price - f.maxPrice) / f.maxPrice * 4); else score += 0.5 + 0.5 * (price / f.maxPrice); }
    if (f.minPrice != null && price != null && price < f.minPrice) miss += 1;
    if (f.maxRent != null && rent != null) { if (rent > f.maxRent) miss += 1 + Math.min(2, (rent - f.maxRent) / f.maxRent * 4); else score += 0.5; }
    if (f.minRent != null && rent != null && rent < f.minRent) miss += 1;
    const plans = l.floorPlans || [];
    if (f.minBeds != null) {
      const beds = l.kind === 'apartments' ? Math.max(-1, ...plans.map((p) => p.beds ?? -1)) : l.beds;
      if (beds == null || beds < f.minBeds) miss += 1 + (beds == null ? 0 : (f.minBeds - beds) * 0.5); else score += beds === f.minBeds ? 0.6 : 0.4;
      if (l.kind === 'apartments' && f.maxRent != null && !plans.some((p) => (p.beds ?? 0) >= f.minBeds && (p.rentMin ?? Infinity) <= f.maxRent)) miss += 0.8;
    }
    if (f.minBaths != null) { if (l.baths == null ? l.kind !== 'apartments' : l.baths < f.minBaths) miss += 1; else score += 0.3; }
    if (f.minSqft != null) { if (!l.sqft || l.sqft < f.minSqft) miss += 1; else score += 0.3; }
    if (f.minLotAcres != null) { if (!l.lotAcres || l.lotAcres < f.minLotAcres) miss += 1; else score += 0.3; }
    if (f.pool === true) { if (l.vexcel?.poolDetected) score += 1; else if (l.listingPool) score += 0.5; else miss += 1.5; }
    if (f.pool === false && l.vexcel?.poolDetected) miss += 1;
    for (const name of f.features || []) { if (hasFeature(l, name)) score += 0.6; else miss += 0.7; }
    for (const word of near || []) {
      const d = nearDist(l, word);
      if (d == null) continue;
      if (d <= NEAR_OK) score += 1.2 * (1 - d / NEAR_OK) + 0.3; else miss += Math.min(1.5, 0.5 + (d - NEAR_OK) / 800);
    }
    if (M.similar) score += 2 * (M.similar.get(l.id) || 0);
    if ((l.matterportIds || []).length) score += 0.15;
    if (M.visited.has(l.id)) miss += 2.5;
    return { miss, score };
  }

  function rank() {
    const s = ctx.car.state;
    const rows = ctx.world.listings.map((l) => {
      const e = evaluate(l, M.filters, M.near);
      const d = Math.hypot(l.x - s.x, l.z - s.z);
      return { l, ...e, d, total: e.score - e.miss * 3 - d / 4000 };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }

  // ---------------------------------------------------------------- mission flow
  function startMission(say, opts = {}) {
    const rows = rank();
    const good = rows.filter((r) => r.miss < 0.75);
    const top = (good.length ? good : rows).slice(0, 5);
    M.top = top.map((r) => r.l);
    M.target = top[0]?.l || null;
    M.active = !!M.target;
    M.arrived = false;
    M.exact = good.length;
    if (!M.target) { speak(pick('ms-none', ['Nothing on the map fits that yet.', 'I have nothing that fits that on this map yet.', 'No home here matches that yet.'])); return; }
    // make sure the kinds we are sending the player to are visible
    for (const l of M.top) if (!ctx.listingsSys.visible[l.kind]) ctx.listingsSys.setVisible(l.kind, true);
    ctx.listingsSys.setHighlights(M.top.map((l) => l.id), M.target);
    reroute(true);
    let line = say || describe({ filters: M.filters, near: M.near });
    if (!good.length) line += ' ' + pick('ms-close', ['Nothing matches everything, so here is the closest fit.', 'No exact match, so I lit up the closest fit.', 'Nothing fits every point, here is the nearest thing.']);
    else if (!opts.quiet) line += good.length === 1 ? ' ' + pick('ms-one', ['One match. Follow the gold line.', 'Just one fits. The gold line takes you there.', 'One home fits. Follow the gold line.'])
      : ' ' + pick('ms-many', [`${Math.min(good.length, 5)} lit up. Follow the gold line to the best one.`, `${Math.min(good.length, 5)} homes lit up. The gold line goes to the best fit.`, `I lit up ${Math.min(good.length, 5)}. The gold line leads to the strongest one.`]);
    speak(line);
    prefetchNarration(M.target);
    ctx.audio.chime();
    ctx.emit('mission', api.info());
  }

  function reroute(force) {
    if (!M.target || !ctx.world) return;
    const s = ctx.car.state;
    const b = M.target.building;
    const goal = b ? { x: b.cx, z: b.cz } : { x: M.target.x, z: M.target.z };
    M.route = findPath(ctx.world, { x: s.x, z: s.z }, goal);
    M.routeLen = pathLength(M.route);
    M.routeAge = 0;
    buildRibbon(M.route);
  }

  function clearMission(silent) {
    M.active = false; M.target = null; M.top = []; M.route = null; M.similar = null;
    M.filters = { ...EMPTY_FILTERS, features: [] }; M.near = [];
    clearRibbon();
    ctx.listingsSys.setHighlights(null, null);
    ctx.hud.arrow(null);
    if (!silent) ctx.emit('mission', api.info());
  }

  function relativeTo(parsed) {
    const ref = M.lastRated?.listing || M.last || M.target || ctx.listingsSys.near;
    if (!ref) return false;
    const f = M.filters;
    const price = ref.price ?? null, rent = ref.rent ?? null;
    if (parsed.relative === 'cheaper') {
      if (price != null) f.maxPrice = Math.round(price * 0.93); else if (rent != null) f.maxRent = Math.round(rent * 0.93);
      if (!f.kind) f.kind = ref.kind === 'sold' ? null : ref.kind;
    } else if (parsed.relative === 'pricier') {
      if (price != null) { f.minPrice = Math.round(price * 1.07); f.maxPrice = null; } else if (rent != null) { f.minRent = Math.round(rent * 1.07); f.maxRent = null; }
    } else if (parsed.relative === 'bigger') {
      if (parsed.relativeOf === 'lot' && ref.lotAcres) f.minLotAcres = Math.round(ref.lotAcres * 1.15 * 100) / 100;
      else if (ref.sqft) f.minSqft = Math.round(ref.sqft * 1.1);
      else if (ref.beds != null) f.minBeds = ref.beds + 1;
    } else if (parsed.relative === 'smaller') {
      f.minSqft = null; if (price != null) f.maxPrice = Math.round(price * 0.95);
    } else if (parsed.relative === 'closer') {
      for (const w of parsed.near) if (!M.near.includes(w)) M.near.unshift(w);
    }
    M.visited.add(ref.id);
    return true;
  }

  async function ensureNear(words) {
    const known = new Set(Object.keys(ctx.world.nearby || {}));
    for (const w of words) {
      if (known.has(w) || M.extraNear[w]) continue;
      try { // a brand new word: one live semantic search through the server, short timeout
        const res = await fetch('/api/near', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: ctx.city, word: w, bbox: ctx.world.area.bbox }), signal: AbortSignal.timeout(4500) });
        const j = res.ok ? await res.json() : null;
        if (j?.tiles?.length) M.extraNear[w] = j.tiles;
      } catch { /* offline: ignore the word */ }
    }
  }

  async function moreLikeThis() {
    const ref = M.lastRated?.listing || M.last || ctx.listingsSys.near || M.target;
    if (!ref) { speak('Visit a home first, then ask for more like it.'); return; }
    let scores = null;
    try {
      const res = await fetch('/api/similar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: ctx.city, lat: ref.lat, lon: ref.lon, bbox: ctx.world.area.bbox }), signal: AbortSignal.timeout(6000) });
      const j = res.ok ? await res.json() : null;
      if (j?.tiles?.length) {
        scores = new Map();
        const max = Math.max(...j.tiles.map((t) => t.score)), min = Math.min(...j.tiles.map((t) => t.score));
        for (const l of ctx.world.listings) {
          let best = 0;
          for (const t of j.tiles) {
            const q = ctx.world.proj.toLocal(t.lat, t.lon);
            if (Math.hypot(q.x - l.x, q.z - l.z) < 45) best = Math.max(best, (t.score - min) / Math.max(1e-6, max - min));
          }
          scores.set(l.id, best);
        }
      }
    } catch { /* fall through to the local comparison */ }
    if (!scores) { // offline: compare the homes' own numbers
      scores = new Map();
      const pv = priceValue(ref) || 1;
      for (const l of ctx.world.listings) {
        let sim = l.kind === ref.kind ? 0.3 : 0;
        sim += 0.3 * Math.max(0, 1 - Math.abs((priceValue(l) || 0) - pv) / pv);
        if (ref.beds != null && l.beds != null) sim += 0.2 * Math.max(0, 1 - Math.abs(l.beds - ref.beds) / 3);
        if (!!l.vexcel?.poolDetected === !!ref.vexcel?.poolDetected) sim += 0.1;
        if (ref.sqft && l.sqft) sim += 0.1 * Math.max(0, 1 - Math.abs(l.sqft - ref.sqft) / ref.sqft);
        scores.set(l.id, sim);
      }
    }
    M.similar = scores;
    M.visited.add(ref.id);
    M.filters = { ...EMPTY_FILTERS, features: [], kind: ref.kind === 'sold' ? null : ref.kind };
    M.near = [];
    startMission('Finding homes that look like this one from above.');
  }

  // one spoken or typed line
  async function handle(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return null;
    ctx.emit('heard', text);
    const local = parseMission(text, { kind: M.filters.kind });
    let parsed = local;
    if (!local.action && !local.reset) {
      try {
        const last = M.lastRated?.listing || M.last;
        const res = await fetch('/api/mission', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ transcript: text, filters: M.filters, last: last ? { price: last.price, rent: last.rent, beds: last.beds, baths: last.baths, sqft: last.sqft } : null }),
          signal: AbortSignal.timeout(4200),
        });
        if (res.ok) { const j = await res.json(); if (j && j.filters) { parsed = { ...local, ...j, filters: { ...EMPTY_FILTERS, ...j.filters, features: j.filters.features || [] } }; M.source = j.source; } }
      } catch { M.source = 'browser'; }
    }
    return apply(parsed, text);
  }

  async function apply(parsed) {
    window.__gpa.lastParse = parsed;
    if (parsed.action) return doAction(parsed);
    if (parsed.reset) { clearMission(); M.visited.clear(); speak(parsed.say || 'Starting fresh.'); return parsed; }
    if (parsed.similar) { await moreLikeThis(); return parsed; }
    if (parsed.empty && !parsed.relative) { speak('Try something like: three beds under 900K with a pool.'); return parsed; }
    if (parsed.relative) {
      if (!relativeTo(parsed)) { speak('Pick a home first, then I can find one that is ' + parsed.relative + '.'); return parsed; }
      M.similar = null;
      // carry anything else said in the same breath ("cheaper with a pool")
      const f = parsed.filters;
      for (const k of ['kind', 'minBeds', 'minBaths', 'pool']) if (f[k] != null) M.filters[k] = f[k];
      for (const x of f.features || []) if (!M.filters.features.includes(x) && !(parsed.relativeOf === 'lot' && x === 'yard')) M.filters.features.push(x);
    } else {
      M.filters = { ...EMPTY_FILTERS, ...parsed.filters, features: [...(parsed.filters.features || [])] };
      M.near = [...(parsed.near || [])];
      M.similar = null;
      M.visited.clear();
      for (const r of [M.lastRated?.listing].filter(Boolean)) M.visited.add(r.id);
    }
    await ensureNear(M.near);
    startMission(parsed.say);
    return parsed;
  }

  function doAction(p) {
    const near = ctx.listingsSys.near;
    if (p.action === 'tour') { if (ctx.tour.active) return p; if (near && (near.matterportIds || []).length) ctx.tour.request(near); else speak('Pull up to a home with a tour first.'); }
    else if (p.action === 'save') { const l = ctx.tour.active ? ctx.tour._state.listing : near; if (l) { ctx.saved.add(l); speak('Saved it.'); } else speak('Pull up to a home first.'); }
    else if (p.action === 'exit') { if (ctx.tour.active) ctx.tour.exit(); }
    else if (p.action === 'empty') { if (ctx.tour.active) ctx.tour.toggleEmpty(); }
    else if (p.action === 'forward') { if (ctx.tour.active) ctx.tour.forward(); }
    else if (p.action === 'compare') ctx.emit('key', 'Tab', null);
    return p;
  }

  // ---------------------------------------------------------------- speech out
  let voice = null;
  function pickVoice() {
    const all = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const en = all.filter((v) => /^en/i.test(v.lang));
    // Prefer on-device voices: remote voices send the text to a third party
    voice = en.find((v) => v.localService && /aria|jenny|zira|samantha|natural/i.test(v.name)) || en.find((v) => v.localService) || (ctx.config.llm ? en[0] : null) || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  let audioEl = null;
  async function speak(text, opts = {}) {
    if (!text) return;
    ctx.hud.caption(text, opts.ms || Math.max(4200, text.length * 62));
    ctx.emit('spoken', text);
    window.__gpa.lastSpoken = text;
    if (ctx.params.has('mute') || ctx.muteVoice) return;
    // one voice in the game: Maya says the line (her caption bubble stays out of it)
    if (ctx.maya) { ctx.maya.say(text, { caption: false, interrupt: opts.interrupt !== false }); return; }
    if (ctx.config.tts) {
      try {
        const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(3500) });
        if (res.ok && (res.headers.get('content-type') || '').includes('audio')) {
          const url = URL.createObjectURL(await res.blob());
          if (audioEl) audioEl.pause();
          audioEl = new Audio(url);
          audioEl.play().catch(() => {});
          return;
        }
      } catch { /* fall back to the browser voice */ }
    }
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.04; u.pitch = 1;
      speechSynthesis.speak(u);
    } catch { /* no voice available */ }
  }

  // ---------------------------------------------------------------- narration
  function narrationPayload(l) {
    // only what the line needs: numbers, highlights and aerial facts (no address, no ids, no agents)
    return { kind: l.kind, price: l.price, rent: l.rent, beds: l.beds, baths: l.baths, sqft: l.sqft, yearBuilt: l.yearBuilt, name: l.kind === 'apartments' ? l.name : undefined,
      highlights: (l.highlights || []).slice(0, 5), aerial: { pool: !!l.vexcel?.poolDetected, listingMentionsPool: !!l.listingPool, treeCoverPct: l.vexcel?.treeCoverPct, roof: l.vexcel?.roofMaterial, solar: !!l.vexcel?.solar, parkMeters: l.nearby?.park, schoolMeters: l.nearby?.school } };
  }
  function prefetchNarration(l) {
    if (!l || M.prefetch.has(l.id)) return;
    const fallback = narrate(l, Math.floor(Math.random() * 3));
    const p = (async () => {
      if (!ctx.config.llm) return fallback;
      try {
        const res = await fetch('/api/narrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(narrationPayload(l)), signal: AbortSignal.timeout(6000) });
        const j = res.ok ? await res.json() : null;
        return j?.text || fallback;
      } catch { return fallback; }
    })();
    M.prefetch.set(l.id, { promise: p, fallback, text: null });
    p.then((t) => { M.prefetch.get(l.id).text = t; });
  }
  function arrive(l) {
    M.arrived = true;
    M.last = l;
    clearRibbon();
    M.route = null;
    ctx.hud.arrow(null);
    ctx.audio.chime();
    ctx.emit('arrived', l);
    if (!M.prefetch.has(l.id)) prefetchNarration(l);
    const pf = M.prefetch.get(l.id);
    speak(pf.text || pf.fallback, { ms: 9000 });
    // the arrival line gives the price and the size: the reveal that follows does not say them again
    ctx.voiceLines?.tell(l.id, 'home');
    M.narrated.add(l.id);
  }

  // ---------------------------------------------------------------- per frame
  ctx.on('update', (dt) => {
    ribbonMat.uniforms.t.value += dt;
    if (!M.active || !M.target || ctx.state !== 'play') return;
    const s = ctx.car.state, tgt = M.target;
    const dx = tgt.mx - s.x, dz = tgt.mz - s.z, d = Math.hypot(dx, dz);
    if (!M.arrived) {
      const ang = Math.atan2(dx, -dz) + s.heading; // relative bearing, 0 = straight ahead
      ctx.hud.arrow({ angle: ang, dist: Math.max(d, 0), label: tgt.name || tgt.address });
      if (d < 150) prefetchNarration(tgt);
      M.routeAge += dt;
      // re-plan when the car has strayed from the ribbon, and every few seconds anyway
      let off = Infinity;
      if (M.route) for (let i = 0; i < Math.min(M.route.length, 40); i++) off = Math.min(off, Math.hypot(M.route[i].x - s.x, M.route[i].z - s.z));
      if (M.routeAge > 4 || (off > 16 && M.routeAge > 0.8)) reroute();
      if (ctx.listingsSys.near === tgt || d < 22) arrive(tgt);
    }
  });
  ctx.on('near-listing', (l) => { if (l) { M.last = l; if (!M.active && !M.narrated.has(l.id)) prefetchNarration(l); } });

  // thumbs up or down after a tour
  ctx.on('tour-exit', (l) => {
    if (!l) return;
    M.last = l;
    if (ctx.demo?.running) return;
    ctx.hud.choose('How was it?', [
      { label: 'Loved it', detail: 'Saves it to your list', key: '↑', code: 'ArrowUp', up: true },
      { label: 'Not for me', detail: 'Keep looking', key: '↓', code: 'ArrowDown', up: false },
    ], (o) => { if (o) rate(l, o.up); }, 'Then say what to change: "something cheaper", "a bigger yard", "closer to a park".');
  });
  function rate(l, up) {
    M.lastRated = { listing: l, liked: up };
    M.visited.add(l.id);
    if (up) { ctx.saved.add(l); ctx.hud.toast('Saved to your list'); } else ctx.hud.toast('Noted. Tell me what to change');
    ctx.emit('rated', l, up);
  }

  ctx.on('city-unload', () => { clearRibbon(); M.active = false; M.target = null; M.route = null; M.top = []; M.visited.clear(); M.prefetch.clear(); M.narrated.clear(); M.last = null; M.lastRated = null; M.extraNear = {}; });
  ctx.on('key', (code) => { if (code === 'KeyX' && ctx.state === 'play' && M.active) { clearMission(); ctx.hud.toast('Mission cleared'); } });

  const api = {
    handle, apply, speak, rate, clearMission, reroute, narrationPayload,
    get route() { return M.route; },
    get target() { return M.target; },
    get active() { return M.active; },
    get state() { return M; },
    info() { return { active: M.active, target: M.target?.id || null, top: M.top.map((l) => l.id), ribbon: !!ribbon, arrived: M.arrived, filters: M.filters, near: M.near, exact: M.exact }; },
  };
  return api;
}
