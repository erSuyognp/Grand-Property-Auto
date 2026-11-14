// The map (M): the whole neighborhood at once on the real Vexcel aerial photo, in its true
// colors. Nothing moves. A dot marks every home and every business on the market: homes for
// sale and businesses for sale are the large dots, the rest (rentals, apartment communities,
// recently sold homes, businesses for lease) are smaller. Hover a dot for its price; click a
// home for a route to it.
import { priceText, money, factsText } from './format.js';

const S = 1600; // pixels of the cached drawing
const KINDS = [
  { key: 'sale', label: 'Home for sale', color: '#19c45f', big: true },
  { key: 'bizsale', label: 'Business for sale', color: '#ff8a1e', big: true },
  { key: 'rent', label: 'Home for rent', color: '#2f8fff' },
  { key: 'apartments', label: 'Apartments', color: '#a25cff' },
  { key: 'sold', label: 'Recently sold', color: '#8d97a3' },
  { key: 'bizlease', label: 'Business for lease', color: '#f2c230' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));

function tipFor(p) {
  if (p.kind === 'bizsale') {
    const price = p.price ? money(p.price) + (p.priceHigh ? ' to ' + money(p.priceHigh) : '') : 'Price on request';
    return [price, `${p.type} for sale${p.sqft ? ' · ' + Math.round(p.sqft).toLocaleString('en-US') + ' sqft' : ''}${p.capRate ? ' · ' + (+p.capRate).toFixed(1) + '% cap rate' : ''}`, (p.name ? p.name + ' · ' : '') + p.address];
  }
  if (p.kind === 'bizlease') {
    const rate = p.rateLow ? `$${Math.round(p.rateLow)}${p.rateHigh && p.rateHigh !== p.rateLow ? ' to $' + Math.round(p.rateHigh) : ''} /sqft/yr` : 'Rate on request';
    return [rate, `${p.type} for lease${p.availableSqft ? ' · ' + Math.round(p.availableSqft).toLocaleString('en-US') + ' sqft open' : ''}`, (p.name ? p.name + ' · ' : '') + p.address];
  }
  return [priceText(p), `${KIND[p.kind].label}${factsText(p) ? ' · ' + factsText(p) : ''}`, (p.name ? p.name + ' · ' : '') + p.address];
}

export function initBigMap(ctx) {
  const el = document.createElement('div');
  el.id = 'bigmap';
  el.innerHTML = `
    <div class="sheet"><canvas width="${S}" height="${S}"></canvas></div>
    <div class="head"><b></b><span></span></div>
    <div class="legend"></div>
    <div class="tip"></div>
    <div class="foot"><kbd>M</kbd> or <kbd>Esc</kbd> back to the car · hover a dot for the price · click a home for a route</div>`;
  document.body.append(el);
  const q = (s) => el.querySelector(s);
  const canvas = q('canvas'), tip = q('.tip');
  const M = { open: false, city: null, hover: null, points: [], photo: null };

  const toPx = (x, z) => { const b = ctx.world.bounds; return [((x - b.minX) / (b.maxX - b.minX)) * S, ((z - b.minZ) / (b.maxZ - b.minZ)) * S]; };

  function photo(world) {
    // the aerial photo as it is, cropped to the area
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const b = world.bounds, img = world.aerial, u0 = world.uvAt(b.minX, b.minZ), u1 = world.uvAt(b.maxX, b.maxZ);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, u0[0] * img.width, (1 - u0[1]) * img.height, (u1[0] - u0[0]) * img.width, (u0[1] - u1[1]) * img.height, 0, 0, S, S);
    return c;
  }

  function collect(world) {
    const pts = [];
    for (const l of world.listings) {
      const [x, y] = toPx(l.building ? l.building.cx : l.x, l.building ? l.building.cz : l.z);
      pts.push({ x, y, kind: l.kind, item: l, listing: true });
    }
    for (const b of world.business || []) {
      const [x, y] = toPx(b.x, b.z);
      pts.push({ x, y, kind: b.kind, item: b, listing: false });
    }
    // big dots last so they sit on top
    pts.sort((a, c) => (KIND[a.kind].big ? 1 : 0) - (KIND[c.kind].big ? 1 : 0));
    return pts;
  }

  // one drawing per change (opening, hovering): there is no frame loop here
  function draw() {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.drawImage(M.photo, 0, 0);
    const mi = ctx.missions.state;
    const r = ctx.missions.route;
    if (mi && mi.active && r && r.length > 1) {
      g.beginPath();
      r.forEach((p, i) => { const [x, y] = toPx(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(20,20,20,0.75)'; g.lineWidth = 9; g.stroke();
      g.strokeStyle = '#ffd24a'; g.lineWidth = 5; g.stroke();
    }
    for (const p of M.points) {
      const k = KIND[p.kind], hov = p === M.hover;
      const rad = (k.big ? 12 : 7.5) * (hov ? 1.3 : 1);
      g.beginPath(); g.arc(p.x, p.y, rad, 0, Math.PI * 2);
      g.fillStyle = k.color; g.fill();
      g.lineWidth = k.big ? 3.5 : 2.5; g.strokeStyle = '#ffffff'; g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.beginPath(); g.arc(p.x, p.y, rad + (k.big ? 2 : 1.5), 0, Math.PI * 2); g.stroke();
    }
    // the car
    const s = ctx.car.state, [cx, cy] = toPx(s.x, s.z);
    g.save();
    g.translate(cx, cy); g.rotate(-s.heading);
    g.beginPath(); g.moveTo(0, -22); g.lineTo(14, 15); g.lineTo(0, 8); g.lineTo(-14, 15); g.closePath();
    g.fillStyle = '#ff3b1f'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
  }

  function open() {
    if (M.open || ctx.state !== 'play' || !ctx.world) return;
    const w = ctx.world;
    if (M.city !== w) { M.photo = photo(w); M.city = w; }
    M.points = collect(w);
    M.hover = null;
    const count = (key) => M.points.filter((p) => p.kind === key).length;
    q('.head b').textContent = w.area.name || w.city;
    q('.head span').textContent = `${count('sale')} homes for sale · ${count('bizsale')} businesses for sale · ${M.points.length} properties in all`;
    q('.legend').innerHTML = KINDS.map((k) => `<span class="${k.big ? 'big' : ''}"><i style="background:${k.color}"></i>${k.label} <em>${count(k.key)}</em></span>`).join('') + '<span><i class="me"></i>You</span>';
    M.open = true;
    ctx.state = 'map';
    el.classList.add('show');
    draw();
    window.__gpa.map = { open: true, points: M.points.length, homesForSale: count('sale'), businessesForSale: count('bizsale') };
  }
  function close() {
    if (!M.open) return;
    M.open = false;
    el.classList.remove('show');
    tip.style.display = 'none';
    if (ctx.state === 'map') ctx.state = 'play';
    window.__gpa.map = { open: false };
  }

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * S, my = ((e.clientY - r.top) / r.height) * S;
    let best = null, bd = 24;
    for (const p of M.points) {
      const d = Math.hypot(p.x - mx, p.y - my) - (KIND[p.kind].big ? 5 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (!M.open) return;
    const h = pick(e);
    if (h !== M.hover) { M.hover = h; draw(); }
    canvas.style.cursor = h ? 'pointer' : 'default';
    if (h) {
      const [price, what, where] = tipFor(h.item);
      tip.innerHTML = '<b></b><span></span><span class="where"></span>';
      tip.children[0].textContent = price;
      tip.children[1].textContent = what;
      tip.children[2].textContent = where;
      tip.style.borderColor = KIND[h.kind].color;
      tip.style.display = 'block';
      tip.style.left = Math.min(window.innerWidth - 290, e.clientX + 18) + 'px';
      tip.style.top = Math.min(window.innerHeight - 110, e.clientY + 16) + 'px';
      window.__gpa.map.tip = price;
    } else tip.style.display = 'none';
  });
  canvas.addEventListener('pointerleave', () => { if (M.hover) { M.hover = null; draw(); } tip.style.display = 'none'; });
  canvas.addEventListener('click', (e) => {
    const p = pick(e);
    if (!p || !p.listing) return;
    close();
    ctx.missions.goTo(p.item);
  });

  ctx.on('key', (code) => {
    if (code === 'KeyM') { if (M.open) close(); else if (!ctx.hud.choosing) open(); } else if (code === 'Escape' && M.open) close();
  });
  ctx.on('city-unload', () => { close(); M.city = null; M.photo = null; });
  addEventListener('resize', () => { if (M.open) draw(); });

  return { open, close, get isOpen() { return M.open; }, points: () => M.points };
}
