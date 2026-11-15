// Bottom left circular minimap that rotates with the car, drawn from the aerial image,
// with listing dots, the mission target and the route.
import { KIND_COLOR } from './format.js';

const SIZE = 196;       // css pixels
const SPAN = 300;       // meters across the map

export function initMinimap(ctx) {
  const wrap = document.createElement('div');
  wrap.id = 'minimap';
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = SIZE * dpr;
  wrap.append(canvas);
  const north = document.createElement('i');
  north.textContent = 'N';
  wrap.append(north);
  document.getElementById('hud').append(wrap);
  const g = canvas.getContext('2d');
  let acc = 0;

  function draw() {
    const world = ctx.world;
    if (!world) return;
    const s = ctx.car.state;
    const R = canvas.width / 2;
    const scale = canvas.width / SPAN; // device px per meter
    g.save();
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#5f7358';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.translate(R, R);
    g.rotate(s.heading);              // car's forward points up
    g.scale(scale, scale);
    g.translate(-s.x, -s.z);
    const G = world.G;
    g.imageSmoothingQuality = 'high';
    g.drawImage(world.mini, G.minX, G.minZ, G.maxX - G.minX, G.maxZ - G.minZ);
    // route
    const route = ctx.missions?.route;
    if (route && route.length > 1) {
      g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = '#ffc940';
      g.beginPath(); g.moveTo(route[0].x, route[0].z);
      for (const p of route) g.lineTo(p.x, p.z);
      g.stroke();
    }
    const L = ctx.listingsSys;
    if (L) {
      const tgt = L.target, hs = L.highlights;
      const pulse = 1 + 0.18 * Math.sin(performance.now() / 260);
      // lit up homes are drawn last, ringed in gold; the rest step back while something is lit
      for (const pass of [0, 1]) for (const it of L.items) {
        if (!L.visible[it.l.kind]) continue;
        if (Math.abs(it.x - s.x) > SPAN || Math.abs(it.z - s.z) > SPAN) continue;
        const isT = tgt && tgt.id === it.l.id, hl = isT || (hs ? hs.has(it.l.id) : false);
        if ((pass === 1) !== hl) continue;
        const dim = hs && !hl;
        g.globalAlpha = dim ? 0.55 : 1;
        g.beginPath(); g.arc(it.x, it.z, isT ? 9 : hl ? 7 : dim ? 3.2 : it.l.kind === 'sold' ? 3.6 : 5.5, 0, Math.PI * 2);
        g.fillStyle = isT ? '#ffc940' : dim ? '#9aa3ad' : KIND_COLOR[it.l.kind];
        g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#10141a'; g.stroke();
        if (hl) { g.beginPath(); g.arc(it.x, it.z, (isT ? 13 : 10.5) * pulse, 0, Math.PI * 2); g.lineWidth = 2.6; g.strokeStyle = '#ffd24a'; g.stroke(); }
      }
      g.globalAlpha = 1;
      // lit up homes off the map: pinned to the rim, in their direction (the target largest)
      const rim = hs ? L.items.filter((it) => hs.has(it.l.id) && L.visible[it.l.kind]).map((it) => it.l) : [];
      if (tgt && !rim.includes(tgt)) rim.push(tgt);
      for (const l of rim.slice(0, 12)) {
        const isT = l === tgt, dx = l.mx - s.x, dz = l.mz - s.z, d = Math.hypot(dx, dz), lim = SPAN / 2 - 10;
        if (d > lim) {
          g.beginPath(); g.arc(s.x + (dx / d) * lim, s.z + (dz / d) * lim, isT ? 8 : 5.5, 0, Math.PI * 2);
          g.fillStyle = isT ? '#ffc940' : KIND_COLOR[l.kind]; g.fill(); g.strokeStyle = isT ? '#10141a' : '#ffd24a'; g.lineWidth = 2; g.stroke();
        }
      }
    }
    g.restore();
    // car arrow, always pointing up
    g.save();
    g.translate(R, R);
    g.fillStyle = '#ff5a2c'; g.strokeStyle = '#fffaf0'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(0, -9 * dpr); g.lineTo(6.5 * dpr, 7 * dpr); g.lineTo(0, 3.5 * dpr); g.lineTo(-6.5 * dpr, 7 * dpr); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    const a = s.heading;
    north.style.transform = `translate(-50%, -50%) translate(${Math.sin(a) * -(SIZE / 2 - 4)}px, ${Math.cos(a) * -(SIZE / 2 - 4)}px)`;
  }

  ctx.on('update', (dt) => {
    acc += dt;
    if (acc < 1 / 30) return;
    acc = 0;
    if (ctx.state === 'play') draw();
  });
  ctx.on('city', draw);
  return { draw, el: wrap };
}
