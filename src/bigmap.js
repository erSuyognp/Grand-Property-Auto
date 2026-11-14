// The map (M): the whole neighborhood at once, drawn from the Vexcel aerial photo as a night
// map. The photo is darkened to blue, buildings are raised with a cast shadow so the sheet
// has relief, the traced streets glow like street lighting, and the area floats as an island
// on a dark sea. On top, live: every listing by kind, the mission's matches and gold route,
// and the car. Click a home to get a route to it. Original artwork, made from our own data.
import { priceText } from './format.js';

const S = 1500; // pixels of the cached base drawing
const COLORS = { sale: '#35e07a', rent: '#49a6ff', apartments: '#b07cff', sold: '#a8b1bb' };

function islandMask() {
  // a soft, slightly ragged outline so the area reads as a land mass, not a square photo
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.filter = 'blur(16px)';
  g.fillStyle = '#fff';
  g.beginPath();
  const n = 220, mid = S / 2, half = S * 0.455;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    // a rounded square (superellipse) with a few slow waves along its edge
    const cs = Math.cos(a), sn = Math.sin(a);
    const r = half / Math.pow(Math.pow(Math.abs(cs), 6) + Math.pow(Math.abs(sn), 6), 1 / 6);
    const wob = 1 + 0.018 * Math.sin(a * 7 + 1.3) + 0.012 * Math.sin(a * 13 + 0.4) + 0.008 * Math.sin(a * 23 + 2.1);
    const x = mid + cs * r * wob, y = mid + sn * r * wob;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath(); g.fill();
  return c;
}

function drawBase(world) {
  const b = world.bounds, W = b.maxX - b.minX, H = b.maxZ - b.minZ;
  const X = (x) => ((x - b.minX) / W) * S, Y = (z) => ((z - b.minZ) / H) * S, k = S / W;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // the aerial photo, turned to night
  const img = world.aerial, u0 = world.uvAt(b.minX, b.minZ), u1 = world.uvAt(b.maxX, b.maxZ);
  g.filter = 'grayscale(60%) brightness(46%) contrast(140%)';
  g.drawImage(img, u0[0] * img.width, (1 - u0[1]) * img.height, (u1[0] - u0[0]) * img.width, (u0[1] - u1[1]) * img.height, 0, 0, S, S);
  g.filter = 'none';
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#8a9fd6';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  // terrain relief: light from the north west
  const get = world.terrainAt || world.heightAt;
  const N = 160, step = W / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = b.minX + (i + 0.5) * step, z = b.minZ + (j + 0.5) * step;
    const sl = (get(x + step, z) - get(x - step, z)) + (get(x, z + step) - get(x, z - step));
    const v = Math.max(-1, Math.min(1, sl / (step * 0.5)));
    if (Math.abs(v) < 0.04) continue;
    g.fillStyle = v < 0 ? `rgba(190,205,255,${Math.min(0.3, -v * 0.5)})` : `rgba(0,0,10,${Math.min(0.5, v * 0.7)})`;
    g.fillRect(X(x - step / 2), Y(z - step / 2), (S / N) + 1, (S / N) + 1);
  }

  // buildings stand up off the sheet: a shadow thrown to the south east, then the roof
  const path = (pts, dx = 0, dy = 0) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.x) + dx, Y(p.y) + dy) : g.moveTo(X(p.x) + dx, Y(p.y) + dy))); g.closePath(); };
  g.fillStyle = 'rgba(0,2,14,0.5)';
  for (const bl of world.buildings) { const o = Math.min(16, 1.2 + bl.h * 0.16) * k * 1.6; path(bl.pts, o, o); g.fill(); }
  for (const bl of world.buildings) {
    path(bl.pts);
    g.fillStyle = `rgba(150,172,225,${Math.min(0.42, 0.13 + bl.h * 0.006)})`;
    g.fill();
    g.strokeStyle = 'rgba(205,220,255,0.22)'; g.lineWidth = 0.8;
    g.stroke();
  }

  // streets: the glow of street lighting, then a bright core
  const segs = world.roads ? world.roads.segments : [];
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (const pass of [0, 1]) {
    for (const s of segs) {
      g.beginPath(); g.moveTo(X(s.x0), Y(s.z0)); g.lineTo(X(s.x1), Y(s.z1));
      if (pass === 0) { g.strokeStyle = 'rgba(255,150,40,0.34)'; g.shadowColor = 'rgba(255,140,30,0.9)'; g.shadowBlur = 14; g.lineWidth = Math.max(2, s.hw * 2 * k * 0.9); } else { g.strokeStyle = 'rgba(255,224,160,0.75)'; g.shadowBlur = 0; g.lineWidth = s.hw > 5 ? 1.8 : 1.1; }
      g.stroke();
    }
  }
  g.shadowBlur = 0;
  // homes glow faintly too: a warm dot on every house sized building
  g.fillStyle = 'rgba(255,196,120,0.5)';
  for (const bl of world.buildings) { if (bl.h < 14) g.fillRect(X(bl.cx) - 0.8, Y(bl.cz) - 0.8, 1.6, 1.6); }
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(islandMask(), 0, 0);
  g.globalCompositeOperation = 'source-over';
  return c;
}

export function initBigMap(ctx) {
  const el = document.createElement('div');
  el.id = 'bigmap';
  el.innerHTML = `
    <div class="sheet"><canvas class="base" width="${S}" height="${S}"></canvas><canvas class="live" width="${S}" height="${S}"></canvas></div>
    <div class="head"><b></b><span></span></div>
    <div class="legend"></div>
    <div class="tip"></div>
    <div class="foot"><kbd>M</kbd> or <kbd>Esc</kbd> back to the car · click a home for a route</div>`;
  document.body.append(el);
  const q = (s) => el.querySelector(s);
  const base = q('.base'), live = q('.live'), tip = q('.tip');
  const M = { open: false, city: null, hover: null, t: 0 };
  let cached = null;

  const toPx = (x, z) => { const b = ctx.world.bounds; return [((x - b.minX) / (b.maxX - b.minX)) * S, ((z - b.minZ) / (b.maxZ - b.minZ)) * S]; };

  function open() {
    if (M.open || ctx.state !== 'play' || !ctx.world) return;
    if (M.city !== ctx.world || !cached) {
      cached = drawBase(ctx.world);
      M.city = ctx.world;
      const g = base.getContext('2d');
      g.clearRect(0, 0, S, S);
      // the city's own light spilling onto the sea around it
      g.shadowColor = 'rgba(255,150,50,0.28)'; g.shadowBlur = 70;
      g.drawImage(cached, 0, 0);
      g.shadowBlur = 0;
      g.drawImage(cached, 0, 0);
    }
    const w = ctx.world, L = w.listings;
    q('.head b').textContent = w.area.name || w.city;
    q('.head span').textContent = `${L.length} homes and communities · ${w.buildings.length.toLocaleString('en-US')} buildings${w.roads ? ' · ' + (w.roads.length / 1000).toFixed(1) + ' km of streets' : ''}`;
    q('.legend').innerHTML = ['sale', 'rent', 'apartments', 'sold'].map((kd) => `<span><i style="background:${COLORS[kd]}"></i>${{ sale: 'For sale', rent: 'For rent', apartments: 'Apartments', sold: 'Recently sold' }[kd]} <em>${L.filter((l) => l.kind === kd).length}</em></span>`).join('') + '<span><i class="me"></i>You</span>';
    M.open = true;
    ctx.state = 'map';
    el.classList.add('show');
    ctx.audio.blip(520, 0.08);
    window.__gpa.map = { open: true, streets: w.roads ? w.roads.segments.length : 0 };
  }
  function close() {
    if (!M.open) return;
    M.open = false;
    el.classList.remove('show');
    tip.style.display = 'none';
    if (ctx.state === 'map') ctx.state = 'play';
    window.__gpa.map = { open: false };
  }

  function shown(l) { return !ctx.listingsSys.visible || ctx.listingsSys.visible[l.kind] !== false; }

  ctx.on('post', (dt) => {
    if (!M.open) return;
    M.t += dt;
    const g = live.getContext('2d');
    g.clearRect(0, 0, S, S);
    const mi = ctx.missions.info ? ctx.missions.state : null;
    const top = new Set((mi && mi.active && mi.top ? mi.top : []).map((l) => l.id));
    // gold route
    const r = ctx.missions.route;
    if (mi && mi.active && r && r.length > 1) {
      g.beginPath();
      r.forEach((p, i) => { const [x, y] = toPx(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.strokeStyle = '#ffd24a'; g.lineWidth = 5; g.lineJoin = 'round'; g.shadowColor = '#ffb400'; g.shadowBlur = 16;
      g.stroke(); g.shadowBlur = 0;
    }
    for (const l of ctx.world.listings) {
      if (!shown(l)) continue;
      const [x, y] = toPx(l.building ? l.building.cx : l.x, l.building ? l.building.cz : l.z);
      const hot = top.has(l.id), hov = l === M.hover;
      const rad = (l.kind === 'sold' ? 5 : 7) * (hot ? 1.5 : 1) * (hov ? 1.35 : 1);
      g.shadowColor = COLORS[l.kind]; g.shadowBlur = hot || hov ? 26 : 12;
      g.fillStyle = COLORS[l.kind];
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 2; g.strokeStyle = 'rgba(8,12,24,0.9)'; g.stroke();
      if (hot) { g.strokeStyle = '#ffd24a'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, rad + 6 + Math.sin(M.t * 4) * 2, 0, Math.PI * 2); g.stroke(); }
    }
    // the car
    const s = ctx.car.state, [cx, cy] = toPx(s.x, s.z);
    g.save();
    g.translate(cx, cy); g.rotate(-s.heading);
    const pulse = 1 + Math.sin(M.t * 5) * 0.08;
    g.scale(pulse, pulse);
    g.beginPath(); g.moveTo(0, -20); g.lineTo(13, 14); g.lineTo(0, 7); g.lineTo(-13, 14); g.closePath();
    g.shadowColor = '#ff5a2a'; g.shadowBlur = 22;
    g.fillStyle = '#ff5a2a'; g.fill();
    g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
  });

  function pick(e) {
    const r = live.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * S, my = ((e.clientY - r.top) / r.height) * S;
    let best = null, bd = 22;
    for (const l of ctx.world.listings) {
      if (!shown(l)) continue;
      const [x, y] = toPx(l.building ? l.building.cx : l.x, l.building ? l.building.cz : l.z);
      const d = Math.hypot(x - mx, y - my);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  live.addEventListener('pointermove', (e) => {
    if (!M.open) return;
    M.hover = pick(e);
    live.style.cursor = M.hover ? 'pointer' : 'default';
    if (M.hover) {
      const l = M.hover;
      tip.innerHTML = '<b></b><span></span>';
      tip.firstChild.textContent = priceText(l);
      tip.lastChild.textContent = (l.name ? l.name + ' · ' : '') + l.address;
      tip.style.display = 'block';
      tip.style.left = Math.min(window.innerWidth - 260, e.clientX + 16) + 'px';
      tip.style.top = e.clientY + 14 + 'px';
    } else tip.style.display = 'none';
  });
  live.addEventListener('click', (e) => {
    const l = pick(e);
    if (!l) return;
    close();
    ctx.missions.goTo(l);
  });

  ctx.on('key', (code) => {
    if (code === 'KeyM') { if (M.open) close(); else if (!ctx.hud.choosing) open(); } else if (code === 'Escape' && M.open) close();
  });
  ctx.on('city-unload', () => { close(); cached = null; M.city = null; });

  return { open, close, get isOpen() { return M.open; } };
}
