// Buyer tools: the things a real buyer or renter would use.
//  - "Can I afford it?" (P): income, debts, savings and a target give a monthly budget by the
//    common 28% / 36% guideline; every marker gets a ring (comfortable, stretch, out of range).
//  - My places: up to 3 pinned places (work, a school, a gym) by name, address or a click on
//    the map; estimated drive times from every home; rings can show weekly drive time instead.
//  - Sun and light: a time of day slider on a selected home moves the real sun.
//  - Same money, other city: what the same monthly cost gets in the other city.
// Everything is saved in this browser only.
import * as THREE from 'three';
import * as SunCalc from 'suncalc';
import { affordability, affordTier, driveMin } from './costmath.js';
import { meters } from './mayaTools.js';
import { icon } from './icons.js';
import { money } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const TIER = { comfortable: ['#3ddc84', 'Comfortable', 'check'], stretch: ['#ffc940', 'A stretch', 'triangle-alert'], out: ['#8b95a5', 'Out of range', 'x'] };
// well known places people name out loud (public coordinates), tried before the address search
const GAZ = {
  la: { 'union station': [34.0562, -118.2365], downtown: [34.0537, -118.2428], 'santa monica': [34.0195, -118.4912], hollywood: [34.1016, -118.3267], burbank: [34.1808, -118.309], lax: [33.9416, -118.4085], ucla: [34.0689, -118.4452], usc: [34.0224, -118.2851], 'century city': [34.0557, -118.4179], 'culver city': [34.0211, -118.3965], pasadena: [34.1478, -118.1445], glendale: [34.1425, -118.2551], 'beverly hills': [34.0736, -118.4004], koreatown: [34.0618, -118.3004] },
  houston: { downtown: [29.7604, -95.3698], 'medical center': [29.7079, -95.4009], 'texas medical center': [29.7079, -95.4009], galleria: [29.7399, -95.4632], 'rice university': [29.7174, -95.4018], 'energy corridor': [29.7836, -95.629], heights: [29.7989, -95.398], 'the heights': [29.7989, -95.398], 'greenway plaza': [29.7328, -95.4321], hobby: [29.6454, -95.2789], 'university of houston': [29.7199, -95.3422], montrose: [29.7447, -95.3907], 'memorial park': [29.7647, -95.4418], midtown: [29.7418, -95.3774] },
  mock: { downtown: [35.03, -99.97], 'the office park': [35.012, -99.985], 'robin park': [35.002, -100.003] },
};
const TZ = { la: -8, houston: -6, mock: -8 }; // standard time, November
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

export function initBuyer(ctx) {
  const B = { profile: null, places: [], aff: null, ringMode: 'afford', pinning: null, sunHour: null };
  try { const j = JSON.parse(localStorage.getItem('gpa-buyer') || '{}'); B.profile = j.profile || null; B.ringMode = j.ringMode || 'afford'; B.placesByCity = j.places || {}; } catch { B.placesByCity = {}; }
  B.placesByCity ||= {};
  const persist = () => { try { localStorage.setItem('gpa-buyer', JSON.stringify({ profile: B.profile, ringMode: B.ringMode, places: B.placesByCity })); } catch { /* private mode */ } };

  // ---- tool dock (top left)
  const dock = document.createElement('div');
  dock.id = 'dock';
  ctx.hud.root.append(dock);
  const sheet = document.createElement('div');
  sheet.id = 'bsheet';
  document.body.append(sheet);
  function renderDock() {
    const a = B.aff;
    dock.innerHTML = `<button data-a="inbox" title="Client inbox (I)">${icon('inbox', 15)}<span>Clients</span><kbd>I</kbd></button>
      <button data-a="profile" class="${a ? 'set' : ''}" title="Can I afford it? (P)">${icon('calculator', 15)}<span>${a ? `Budget ${usd(a.budget)}/mo` : 'Can I afford it?'}</span><kbd>P</kbd></button>
      <button data-a="places" class="${B.places.length ? 'set' : ''}" title="My places (O)">${icon('map-pin', 15)}<span>${B.places.length ? B.places.map((p) => esc(p.name)).join(', ') : 'My places'}</span><kbd>O</kbd></button>
      <button data-a="settings" title="Settings (U)" aria-label="Settings">${icon('settings', 15)}<kbd>U</kbd></button>
      ${a || B.places.length ? `<button data-a="rings" title="What the rings under the markers show">${icon('activity', 15)}<span>Rings: ${B.ringMode === 'afford' ? 'budget' : B.ringMode === 'drive' ? 'weekly drive' : 'off'}</span></button>` : ''}`;
    for (const b of dock.children) b.addEventListener('click', () => { b.blur(); ({ inbox: () => ctx.clients?.open(), profile: openProfile, places: openPlaces, rings: cycleRings, settings: () => ctx.settingsUI?.open() })[b.dataset.a](); });
    legend();
  }
  function cycleRings() {
    const modes = ['afford', 'drive', 'off'].filter((m) => m === 'off' || (m === 'afford' ? B.aff : B.places.length));
    B.ringMode = modes[(modes.indexOf(B.ringMode) + 1) % modes.length] || 'off';
    persist(); renderDock(); rings();
    ctx.hud.toast(B.ringMode === 'afford' ? 'Rings show your budget' : B.ringMode === 'drive' ? 'Rings show weekly drive time to your places' : 'Rings off', 1800);
  }
  const key = document.createElement('div');
  key.id = 'ringkey';
  ctx.hud.root.append(key);
  function legend() {
    const mode = ringModeNow();
    key.classList.toggle('show', mode !== 'off');
    key.innerHTML = mode === 'afford' ? Object.values(TIER).map(([c, t, ic]) => `<span><i style="background:${c}"></i>${icon(ic, 12)}${t}</span>`).join('') : mode === 'drive' ? `<span><i style="background:#3ddc84"></i>Less driving</span><span><i style="background:#ff6b6b"></i>More driving each week</span>` : '';
  }
  const ringModeNow = () => (B.ringMode === 'afford' && B.aff ? 'afford' : B.ringMode === 'drive' && B.places.length ? 'drive' : B.ringMode === 'afford' && !B.aff && B.places.length ? 'drive' : 'off');

  // ---- the numbers
  function recompute() {
    const m = ctx.insights.money || {};
    B.aff = B.profile?.income ? affordability(B.profile, { ratePct: m.rate?.rate || 7, taxRatePct: m.taxRatePct || 1.2, insuranceYear: m.insurance?.homeowners || 0 }) : null;
    B.places = B.placesByCity[ctx.city] || [];
  }
  const monthlyOf = (row) => (row ? row.cost ?? row.rent ?? null : null);
  function tierOf(l) { const r = ctx.insights.row(l.id); const t = monthlyOf(r); return B.aff && t ? affordTier(t, B.aff) : null; }
  const weekly = (l) => B.places.reduce((t, p) => t + driveMin(meters(l, p)) * 2 * (p.trips || 5), 0);

  // ---- rings under the markers
  let ringMesh = null;
  function rings() {
    if (ringMesh) { ringMesh.parent?.remove(ringMesh); ringMesh.geometry.dispose(); ringMesh.material.dispose(); ringMesh = null; }
    const world = ctx.world, mode = ringModeNow();
    legend();
    if (!world || mode === 'off' || !ctx.listingsSys.items.length) return;
    const items = ctx.listingsSys.items;
    const geo = new THREE.RingGeometry(6.2, 8.4, 40);
    geo.rotateX(-Math.PI / 2);
    ringMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, toneMapped: false }), items.length);
    ringMesh.renderOrder = 3; ringMesh.frustumCulled = false;
    const d = new THREE.Object3D(), c = new THREE.Color();
    const w = mode === 'drive' ? items.map((it) => weekly(it.l)) : null;
    const lo = w ? Math.min(...w) : 0, hi = w ? Math.max(...w) : 1;
    items.forEach((it, i) => {
      let color = null;
      if (mode === 'afford') { const t = tierOf(it.l); color = t ? TIER[t][0] : null; } else { const k = hi > lo ? (w[i] - lo) / (hi - lo) : 0; color = '#' + c.setRGB(0.24 + 0.76 * k, 0.86 - 0.44 * k, 0.52 - 0.1 * k).getHexString(); }
      d.position.set(it.x, it.ground + 0.7, it.z);
      d.scale.setScalar(color && ctx.listingsSys.visible[it.l.kind] ? Math.max(0.8, it.size) : 0.0001);
      d.updateMatrix();
      ringMesh.setMatrixAt(i, d.matrix);
      ringMesh.setColorAt(i, c.set(color || '#000000'));
    });
    ringMesh.instanceColor.needsUpdate = true;
    world.group.add(ringMesh);
  }
  ctx.on('filters', rings);

  // ---- "Can I afford it?" sheet
  function field(id, label, value, hint) { return `<label><span>${label}</span><div class="inp"><i>$</i><input id="${id}" inputmode="numeric" value="${value ? Math.round(value).toLocaleString('en-US') : ''}" placeholder="0" autocomplete="off"/></div><small>${hint}</small></label>`; }
  function openSheet(html, onOpen) {
    if (ctx.state !== 'play' && ctx.state !== 'sheet') return false;
    ctx.state = 'sheet';
    sheet.innerHTML = `<div class="bcard" role="dialog">${html}</div>`;
    sheet.classList.add('show');
    onOpen?.(sheet);
    setTimeout(() => sheet.querySelector('input,button')?.focus(), 60);
    return true;
  }
  function closeSheet() { if (!sheet.classList.contains('show')) return; if (sheet.contains(document.activeElement)) document.activeElement.blur(); sheet.classList.remove('show'); if (ctx.state === 'sheet') ctx.state = 'play'; B.sheet = null; }
  const num = (v) => Number(String(v).replace(/[^\d.]/g, '')) || 0;
  function openProfile() {
    const p = B.profile || {};
    B.sheet = 'profile';
    openSheet(`<h2>${icon('calculator', 20)}Can I afford it?</h2><p class="lead">Four numbers, kept in this browser only. They set a monthly budget by the common 28% / 36% guideline and mark every home on the map.</p>
      <form><div class="grid">${field('pf-income', 'Yearly income before tax', p.income, 'Everyone on the loan')}${field('pf-debts', 'Monthly debt payments', p.debts, 'Car, student loans, cards')}${field('pf-savings', 'Savings for a down payment', p.savings, 'Cash you can put down')}${field('pf-target', 'Monthly cost you would like', p.target, 'Optional: caps the budget')}</div>
      <div class="bresult" aria-live="polite"></div>
      <p class="fine">A guideline lenders often use, not advice: housing up to 28% of gross income, housing plus other debts up to 36%. Uses this week's average 30 year rate${ctx.insights.money?.rate ? ` (${ctx.insights.money.rate.rate}%)` : ''}. Not financial advice.</p>
      <div class="ract"><button type="button" class="act" data-a="clear">Clear</button><button type="button" class="act" data-a="cancel">Cancel <kbd>Esc</kbd></button><button class="act primary" type="submit">Save <kbd>Enter</kbd></button></div></form>`, (root) => {
      const read = () => ({ income: num(root.querySelector('#pf-income').value), debts: num(root.querySelector('#pf-debts').value), savings: num(root.querySelector('#pf-savings').value), target: num(root.querySelector('#pf-target').value) });
      const show = () => {
        const v = read(), m = ctx.insights.money || {};
        const box = root.querySelector('.bresult');
        if (!v.income) { box.innerHTML = '<p>Enter your income to see your range.</p>'; return; }
        const a = affordability(v, { ratePct: m.rate?.rate || 7, taxRatePct: m.taxRatePct || 1.2, insuranceYear: m.insurance?.homeowners || 0 });
        const n = ctx.insights.rows().filter((r) => monthlyOf(r) && monthlyOf(r) <= a.budget).length;
        box.innerHTML = `<div><b>${usd(a.budget)}</b><span>comfortable each month<br><small>limited by ${esc(a.limitedBy)}</small></span></div><div><b>${money(a.maxPrice)}</b><span>home price that fits<br><small>with ${usd(v.savings)} down</small></span></div><div><b>${n}</b><span>homes here in range<br><small>of ${ctx.insights.rows().length}</small></span></div>`;
      };
      for (const i of root.querySelectorAll('input')) { i.addEventListener('input', show); i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeSheet(); }); }
      show();
      root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); setProfile(read()); closeSheet(); });
      root.querySelector('[data-a="cancel"]').addEventListener('click', closeSheet);
      root.querySelector('[data-a="clear"]').addEventListener('click', () => { setProfile(null); closeSheet(); });
    });
  }
  function setProfile(p) {
    B.profile = p && p.income ? { income: num(p.income), debts: num(p.debts || B.profile?.debts || 0), savings: num(p.savings || B.profile?.savings || 0), target: num(p.target || 0) } : null;
    if (B.profile && B.ringMode === 'off') B.ringMode = 'afford';
    persist(); recompute(); renderDock(); rings(); ctx.panel.refresh(); pub();
    if (B.aff) ctx.hud.toast(`Comfortable up to ${usd(B.aff.budget)} a month`, 2600);
    ctx.emit('buyer', B);
  }
  function affordLine(total) {
    if (!B.aff || !total) return B.aff ? '' : `<p class="versus"><button class="linkbtn" data-open="profile">${icon('calculator', 14)}Can I afford it? Add your numbers</button></p>`;
    const t = affordTier(total, B.aff), d = B.aff.budget - total;
    const text = t === 'comfortable' ? `About <b>${usd(d)}</b> under your comfortable budget` : t === 'stretch' ? `A stretch: <b>${usd(-d)}</b> over your comfortable ${usd(B.aff.budget)}` : `Out of range: <b>${usd(-d)}</b> over your comfortable ${usd(B.aff.budget)}`;
    return `<p class="versus ${t === 'comfortable' ? 'good' : t === 'stretch' ? 'warn' : 'out'}">${icon(TIER[t][2], 15)}${text} <small>(28% / 36% guideline)</small></p>`;
  }

  // ---- my places
  async function geocode(where) {
    const q = String(where || '').toLowerCase().replace(/^(near|at|by|in|on|the)\s+/g, '').trim();
    const g = GAZ[ctx.city] || {};
    const hit = Object.keys(g).sort((a, b) => b.length - a.length).find((k) => q.includes(k));
    if (hit) return { lat: g[hit][0], lon: g[hit][1], label: hit.replace(/\b\w/g, (c) => c.toUpperCase()) };
    if (ctx.mock) return null;
    try {
      const city = ctx.city === 'la' ? 'Los Angeles, CA' : 'Houston, TX';
      const r = await fetch('/api/geocode?q=' + encodeURIComponent(/\d/.test(q) && !/,/.test(q) ? `${q}, ${city}` : q), { signal: AbortSignal.timeout(7000) });
      if (r.ok) { const j = await r.json(); if (j && Number.isFinite(j.lat)) return j; }
    } catch { /* offline */ }
    return null;
  }
  function addPlace(name, lat, lon, label) {
    const list = (B.placesByCity[ctx.city] ||= []);
    const i = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    const item = { name: name.slice(0, 24), lat, lon, label: label || '', trips: 5 };
    if (i >= 0) list[i] = item; else { if (list.length >= 3) list.shift(); list.push(item); }
    if (B.ringMode === 'off' || (B.ringMode === 'afford' && !B.aff)) B.ringMode = 'drive';
    persist(); recompute(); renderDock(); rings(); pins(); ctx.panel.refresh(); pub();
    ctx.hud.toast(`${item.name} pinned${label ? ': ' + label : ''}`, 2400);
    ctx.audio.chime();
    ctx.emit('buyer', B);
    return item;
  }
  async function pinByName(name, where) {
    const g = await geocode(where);
    if (!g) { ctx.hud.toast(`Could not find "${where}". Press O and click the map instead`, 3200); return null; }
    return addPlace(name || 'Place', g.lat, g.lon, g.label || where);
  }
  function removePlace(i) { (B.placesByCity[ctx.city] || []).splice(i, 1); persist(); recompute(); renderDock(); rings(); pins(); ctx.panel.refresh(); pub(); }
  function openPlaces() {
    B.sheet = 'places';
    const list = B.places;
    openSheet(`<h2>${icon('map-pin', 20)}My places</h2><p class="lead">Pin up to 3 places that matter: work, a school, a gym. Every home then shows the drive, and the rings on the map can show weekly drive time.</p>
      <ul class="plist">${list.map((p, i) => `<li>${icon('map-pin', 15)}<b>${esc(p.name)}</b><span>${esc(p.label || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`)}</span><button class="act ghost" data-rm="${i}" aria-label="Remove ${esc(p.name)}">Remove</button></li>`).join('') || '<li class="empty">Nothing pinned yet.</li>'}</ul>
      <form class="padd"><select id="pl-name" aria-label="What is it">${['Work', 'School', 'Gym', 'Family', 'Other'].map((n) => `<option>${n}</option>`).join('')}</select><input id="pl-where" placeholder="${ctx.city === 'houston' ? 'Medical Center, or 1000 Main St' : 'Union Station, or 200 N Spring St'}" autocomplete="off" aria-label="Name or address"/><button class="act primary" type="submit">Find</button></form>
      <div class="ract"><button type="button" class="act" data-a="map">${icon('map-pin', 15)}Click the map instead</button><button type="button" class="act" data-a="cancel">Done <kbd>Esc</kbd></button></div>
      <p class="fine">You can also tell Maya: "my work is near ${ctx.city === 'houston' ? 'the Medical Center' : 'Union Station'}". Addresses are looked up with the Census Bureau's address search. Drive times are estimates from distance at 25 mph.</p>`, (root) => {
      const inp = root.querySelector('#pl-where');
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeSheet(); });
      root.querySelector('.padd').addEventListener('submit', async (e) => { e.preventDefault(); if (!inp.value.trim()) return; const ok = await pinByName(root.querySelector('#pl-name').value, inp.value.trim()); if (ok) openPlaces(); });
      for (const b of root.querySelectorAll('[data-rm]')) b.addEventListener('click', () => { removePlace(Number(b.dataset.rm)); openPlaces(); });
      root.querySelector('[data-a="cancel"]').addEventListener('click', closeSheet);
      root.querySelector('[data-a="map"]').addEventListener('click', () => { const name = root.querySelector('#pl-name').value; closeSheet(); B.pinning = name; document.body.classList.add('pinning'); ctx.hud.toast(`Click the map where your ${name.toLowerCase()} is. Esc cancels`, 4000); if (ctx.cam.view !== 'top') { /* any view works */ } });
    });
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  function pinAtScreen(sx, sy) {
    if (!B.pinning) return;
    ray.setFromCamera(ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), ctx.camera);
    plane.constant = -ctx.car.state.y;
    if (!ray.ray.intersectPlane(plane, hitP)) return;
    const ll = ctx.world.proj.toLatLon(hitP.x, hitP.z);
    const name = B.pinning;
    B.pinning = null; document.body.classList.remove('pinning');
    addPlace(name, ll.lat, ll.lon, 'picked on the map');
  }
  // pins in the world for places inside the map
  let pinGroup = null;
  function pins() {
    if (pinGroup) { pinGroup.parent?.remove(pinGroup); pinGroup = null; }
    const world = ctx.world;
    if (!world || !B.places.length) return;
    pinGroup = new THREE.Group();
    for (const p of B.places) {
      const q = world.proj.toLocal(p.lat, p.lon), b = world.bounds;
      if (q.x < b.minX || q.x > b.maxX || q.z < b.minZ || q.z > b.maxZ) continue;
      const y = world.heightAt(q.x, q.z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 26, 8), new THREE.MeshBasicMaterial({ color: 0xff5a7a, fog: false, toneMapped: false }));
      stem.position.set(q.x, y + 13, q.z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff5a7a, fog: false, toneMapped: false }));
      head.position.set(q.x, y + 28, q.z);
      pinGroup.add(stem, head);
    }
    world.group.add(pinGroup);
  }
  function placeRows(l) {
    if (!B.places.length) return `<li class="wide"><button class="linkbtn" data-open="places">${icon('map-pin', 14)}Add your work or other places to see the drive</button></li>`;
    return B.places.map((p) => `<li>${icon('map-pin', 15)}<span>${esc(p.name)} <small>${esc(p.label || '')}</small></span><b>${driveMin(meters(l, p))} min drive</b></li>`).join('') + `<li>${icon('clock', 15)}<span>Driving each week <small>${B.places.map((p) => p.trips || 5).join(' + ')} round trips</small></span><b>${Math.round(weekly(l) / 6) / 10} hours</b></li>`;
  }

  // ---- sun and light: the real sun position over the selected home for a time of day
  function sunAt(l, hour) {
    const now = new Date();
    const utc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0) + (hour - (TZ[ctx.city] ?? -6)) * 3600e3;
    const pos = SunCalc.getPosition(new Date(utc), l.lat, l.lon);
    const elev = (pos.altitude * 180) / Math.PI, compass = (((pos.azimuth * 180) / Math.PI + 180) % 360 + 360) % 360; // SunCalc: 0 = south, west positive
    const times = SunCalc.getTimes(new Date(utc), l.lat, l.lon);
    const local = (d) => { const h = (d.getUTCHours() + (TZ[ctx.city] ?? -6) + 24) % 24, m = d.getUTCMinutes(); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
    return { elev, compass, side: COMPASS[Math.round(compass / 45) % 8], rise: local(times.sunrise), set: local(times.sunset) };
  }
  const hourLabel = (h) => `${((Math.floor(h) + 11) % 12) + 1}:${h % 1 ? '30' : '00'} ${h < 12 ? 'AM' : 'PM'}`;
  function sunLine(l, hour) {
    const s = sunAt(l, hour);
    if (s.elev <= 0) return `At ${hourLabel(hour)} the sun is down. Sunrise ${s.rise}, sunset ${s.set}.`;
    return `At ${hourLabel(hour)} the sun is ${Math.round(s.elev)}° up in the ${s.side}: the ${s.side} facing side gets direct light. Sunrise ${s.rise}, sunset ${s.set} today.`;
  }
  function applySun(l, hour) {
    B.sunHour = hour;
    if (hour == null) { ctx.env.setSunOverride(null); return; }
    const s = sunAt(l, hour);
    ctx.env.setSunOverride({ elev: s.elev, azim: 180 - s.compass, strength: Math.max(0.08, Math.min(1, s.elev / 25)) });
  }
  function sunControl(l) {
    const h = B.sunHour ?? 15;
    return `<div class="sunctl"><p class="sub2">${icon('sun', 13)} Sun and light</p><input type="range" min="6" max="20" step="0.5" value="${h}" data-sun aria-label="Time of day"/><div class="sunticks"><span>6 AM</span><span>Noon</span><span>8 PM</span></div><p class="fine sunline">${esc(sunLine(l, h))}</p><p class="fine">Sun position for today at this address (SunCalc). Shadows show on the block city.</p></div>`;
  }
  function wirePanel(root, l) {
    const s = root.querySelector('[data-sun]');
    if (s) s.addEventListener('input', () => { const h = Number(s.value); applySun(l, h); root.querySelector('.sunline').textContent = sunLine(l, h); });
    for (const b of root.querySelectorAll('[data-open]')) b.addEventListener('click', () => (b.dataset.open === 'profile' ? openProfile() : openPlaces()));
  }
  ctx.on('select', (l) => { if (!l && B.sunHour != null) applySun(null, null); });

  // ---- same money, other city
  function showOtherCity(r) {
    const o = r.sameMonthlyCostGets || [];
    if (!o.length) return;
    const other = r.otherCity === 'Houston' ? 'houston' : 'la';
    B.sheet = 'other';
    openSheet(`<h2>${icon('plane', 20)}Same money in ${esc(r.otherCity)}</h2><p class="lead">About <b>${usd(r.thisHome.monthly)}</b> a month here gets ${r.thisHome.beds ?? '?'} beds and ${(r.thisHome.sqft || 0).toLocaleString('en-US')} sq ft. In ${esc(r.otherCity)} the same monthly cost gets:</p>
      <ul class="olist">${o.map((x) => `<li><b>${x.price ? money(x.price) : usd(x.monthly) + '/mo'}</b><span>${x.beds ?? '?'} bd · ${(x.sqft || 0).toLocaleString('en-US')} sq ft${x.lotAcres ? ` · ${x.lotAcres.toFixed(2)} acre lot` : ''}${x.poolSeenFromAir ? ' · pool' : ''}</span><em>${usd(x.monthly)} a month</em></li>`).join('')}</ul>
      <p class="fine">Estimated monthly costs. Not financial advice.</p>
      <div class="ract"><button class="act" data-a="cancel">Stay here <kbd>Esc</kbd></button>${ctx.cities.includes(other) ? `<button class="act primary" data-a="go">${icon('plane', 15)}Fast travel to ${esc(r.otherCity)}</button>` : ''}</div>`, (root) => {
      root.querySelector('[data-a="cancel"]').addEventListener('click', closeSheet);
      root.querySelector('[data-a="go"]')?.addEventListener('click', () => { closeSheet(); ctx.reveal.close(); ctx.loadCity(other); });
    });
  }

  ctx.on('insights-ready', () => { recompute(); renderDock(); rings(); pins(); pub(); });
  ctx.on('city-unload', () => { ringMesh = null; pinGroup = null; B.pinning = null; document.body.classList.remove('pinning'); closeSheet(); });
  ctx.on('key', (code) => {
    if (code === 'Escape') { if (B.pinning) { B.pinning = null; document.body.classList.remove('pinning'); } closeSheet(); return; }
    if (ctx.state !== 'play' || ctx.hud.choosing) return;
    if (code === 'KeyP') openProfile();
    else if (code === 'KeyO') openPlaces();
  });
  function pub() { window.__gpa.buyer = { profile: B.profile, budget: B.aff?.budget || null, maxPrice: B.aff?.maxPrice || null, places: B.places.map((p) => p.name), ringMode: ringModeNow(), setProfile: (p) => setProfile(p), pin: (n, w) => pinByName(n, w), tiers: () => Object.fromEntries(ctx.world.listings.map((l) => [l.id, tierOf(l)])) }; }
  renderDock(); pub();

  return {
    get profile() { return B.profile; },
    get places() { return B.places; },
    get aff() { return B.aff; },
    get pinning() { return !!B.pinning; },
    setProfile, openProfile, openPlaces, pinByName, pinAtScreen, affordLine, placeRows, sunControl, wirePanel, showOtherCity, tierOf, weekly, sunLine, applySun, closeSheet,
    driveTo: (l) => B.places.map((p) => ({ name: p.name, min: driveMin(meters(l, p)) })),
  };
}
