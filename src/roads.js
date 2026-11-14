// Streets traced from the aerial photo. There is no road data, but streets in these
// neighborhoods are long straight strips of asphalt on a grid, which a parking lot, a driveway
// or a roof is not. So: find the grid's angle, turn the photo to it, and look along every row
// and column for long unbroken runs of asphalt colored pixels that no building interrupts.
// Runs that sit side by side form one street with a center line and a width.
//
// The result is baked into a distance map (meters to the edge of the nearest street, to its
// center line, and to the next street over) that the ground shader turns into asphalt, lane
// paint, kerbs and sidewalks that stay sharp at any distance.
import * as THREE from 'three';

const GAP = 16;        // meters of trees, cars or shadow a run may cross
const MIN_RUN = 110;   // meters: shorter strips are lots and driveways
const MAP = 2048;

function isAsphalt(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 30 && mx > 46 && mx < 205) return true;       // gray, mid bright
  return mx < 95 && mx > 18 && b >= r - 4 && mx - mn < 62;     // the same in shadow
}

// The street grid runs the way the buildings face: take every wall, weight it by its length,
// and find the most common direction (walls at right angles count as the same direction).
function gridAngle(buildings) {
  const BINS = 360; // quarter degree steps over 90 degrees
  const hist = new Float32Array(BINS);
  for (const b of buildings) {
    const p = b.pts;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      const dx = q.x - p[i].x, dz = q.y - p[i].y, len = Math.hypot(dx, dz);
      if (len < 3) continue;
      let a = Math.atan2(dz, dx) % (Math.PI / 2);
      if (a < 0) a += Math.PI / 2;
      hist[Math.min(BINS - 1, Math.floor((a / (Math.PI / 2)) * BINS))] += len;
    }
  }
  let best = 0, bs = -1;
  for (let i = 0; i < BINS; i++) {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += hist[(i + k + BINS) % BINS] * (5 - Math.abs(k));
    if (s > bs) { bs = s; best = i; }
  }
  let a = ((best + 0.5) / BINS) * (Math.PI / 2);
  if (a > Math.PI / 4) a -= Math.PI / 2;
  return a;
}

// long runs along one direction of the turned photo; get(i, j): i across, j along
function scan(S, road, hard, alongRows) {
  const at = alongRows ? (i, j) => i * S + j : (i, j) => j * S + i;
  const bands = [], open = [];
  const close = (b) => {
    const rows = b.runs.length, width = b.last - b.first + 1;
    if (rows < 4 || rows / width < 0.7) return;
    const med = (arr) => arr.slice().sort((x, y) => x - y)[Math.floor(arr.length / 2)];
    const j0 = med(b.runs.map((r) => r[0])), j1 = med(b.runs.map((r) => r[1]));
    const len = j1 - j0;
    if (len < MIN_RUN || width > 34 || len / width < 7) return;
    bands.push({ c: (b.first + b.last + 1) / 2, j0, j1: j1 + 1, width, alongRows });
  };
  for (let i = 0; i < S; i++) {
    const runs = [];
    let start = -1, last = -1, fill = 0;
    const end = () => {
      if (start >= 0 && last - start >= MIN_RUN && fill / (last - start + 1) >= 0.58) runs.push([start, last]);
      start = -1; fill = 0;
    };
    for (let j = 0; j < S; j++) {
      const k = at(i, j);
      if (hard[k]) { end(); continue; }
      if (road[k]) { if (start < 0) start = j; last = j; fill++; } else if (start >= 0 && j - last > GAP) end();
    }
    end();
    for (const r of runs) {
      let hit = null;
      for (const b of open) {
        if (i - b.last > 2 || b.last === i) continue;
        const inter = Math.min(r[1], b.j1) - Math.max(r[0], b.j0), uni = Math.max(r[1], b.j1) - Math.min(r[0], b.j0);
        if (inter / uni >= 0.55) { hit = b; break; }
      }
      if (hit) { hit.runs.push(r); hit.last = i; hit.j0 = r[0]; hit.j1 = r[1]; } else open.push({ first: i, last: i, j0: r[0], j1: r[1], runs: [r] });
    }
    for (let n = open.length - 1; n >= 0; n--) if (i - open[n].last > 2) { close(open[n]); open.splice(n, 1); }
  }
  open.forEach(close);
  return bands;
}

export function buildRoads({ img, uvAt, G, bounds, buildings }) {
  const t0 = performance.now();
  const W = bounds.maxX - bounds.minX, H = bounds.maxZ - bounds.minZ;
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const angle = gridAngle(buildings);
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const S = Math.min(2600, Math.ceil(Math.hypot(W, H)) + 4);
  const scale = S / (Math.ceil(Math.hypot(W, H)) + 4); // 1 px per meter unless the area is huge

  // the photo and the building outlines, turned so the grid lies along rows and columns
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const pc = mk(), bc = mk();
  const pg = pc.getContext('2d', { willReadFrequently: true }), bg = bc.getContext('2d', { willReadFrequently: true });
  for (const g of [pg, bg]) { g.setTransform(cs * scale, -sn * scale, sn * scale, cs * scale, S / 2, S / 2); g.translate(-cx, -cz); }
  pg.save();
  pg.beginPath(); pg.rect(bounds.minX, bounds.minZ, W, H); pg.clip();
  pg.drawImage(img, G.minX, G.minZ, G.maxX - G.minX, G.maxZ - G.minZ);
  pg.restore();
  bg.fillStyle = '#fff';
  for (const b of buildings) {
    bg.beginPath();
    b.pts.forEach((p, i) => (i ? bg.lineTo(p.x, p.y) : bg.moveTo(p.x, p.y)));
    bg.closePath(); bg.fill();
  }
  const pd = pg.getImageData(0, 0, S, S).data, bd = bg.getImageData(0, 0, S, S).data;
  const road = new Uint8Array(S * S), hard = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    if (pd[i * 4 + 3] < 200 || bd[i * 4] > 100) { hard[i] = 1; continue; }
    if (isAsphalt(pd[i * 4], pd[i * 4 + 1], pd[i * 4 + 2])) road[i] = 1;
  }
  // one street often comes back as two strips (a row of parked cars or a painted median
  // splits it): join strips that run side by side
  const join = (list) => {
    list.sort((a, b) => a.c - b.c);
    for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++) {
      const a = list[i], b = list[k];
      const gap = Math.abs(b.c - a.c) - (a.width + b.width) / 2;
      const inter = Math.min(a.j1, b.j1) - Math.max(a.j0, b.j0), uni = Math.max(a.j1, b.j1) - Math.min(a.j0, b.j0);
      if (gap > 5 || inter / uni < 0.5) continue;
      const lo = Math.min(a.c - a.width / 2, b.c - b.width / 2), hi = Math.max(a.c + a.width / 2, b.c + b.width / 2);
      if (hi - lo > 40) continue;
      list[i] = { ...a, c: (lo + hi) / 2, width: hi - lo, j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) };
      list.splice(k, 1);
      k = i; // start over against the wider strip
    }
    return list;
  };
  const across = join(scan(S, road, hard, true)), down = join(scan(S, road, hard, false));
  // a street that stops just short of a crossing street runs on to its center line
  const meet = (A, B) => {
    for (const a of A) for (const b of B) {
      if (a.c < b.j0 - 6 || a.c > b.j1 + 6) continue;
      const reach = b.width / 2 + 14;
      if (Math.abs(a.j0 - b.c) < reach) a.j0 = Math.min(a.j0, b.c);
      if (Math.abs(a.j1 - b.c) < reach) a.j1 = Math.max(a.j1, b.c);
    }
  };
  meet(across, down); meet(down, across);
  const bands = [...across, ...down];

  // back to world meters: center line end points and half width
  const toWorld = (u, v) => { const a = (u - S / 2) / scale, b = (v - S / 2) / scale; return { x: cx + a * cs - b * sn, z: cz + a * sn + b * cs }; };
  const segments = bands.map((b) => {
    const p0 = b.alongRows ? toWorld(b.j0, b.c) : toWorld(b.c, b.j0), p1 = b.alongRows ? toWorld(b.j1, b.c) : toWorld(b.c, b.j1);
    let hw = b.width / scale / 2;
    if (hw > 10.5) hw -= 3.4; // building to building: the outer strips are sidewalk
    hw = Math.max(2.6, hw - 0.3);
    return { x0: p0.x, z0: p0.z, x1: p1.x, z1: p1.z, hw, rows: b.alongRows };
  });
  const length = segments.reduce((a, s) => a + Math.hypot(s.x1 - s.x0, s.z1 - s.z0), 0);
  if (length < 300) return null;

  // distance map: sd to the nearest street edge (negative inside), distance to that street's
  // center line, sd to the next street, and its half width (negative for column streets)
  const N = MAP, far = 60;
  const sd1 = new Float32Array(N * N).fill(far), sd2 = new Float32Array(N * N).fill(far), cd = new Float32Array(N * N).fill(far), hwm = new Float32Array(N * N);
  const pxm = W / N, pzm = H / N;
  for (const s of segments) {
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2, hl = len / 2, m = s.hw + 14;
    const c0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - m - bounds.minX) / pxm)), c1 = Math.min(N - 1, Math.ceil((Math.max(s.x0, s.x1) + m - bounds.minX) / pxm));
    const r0 = Math.max(0, Math.floor((Math.min(s.z0, s.z1) - m - bounds.minZ) / pzm)), r1 = Math.min(N - 1, Math.ceil((Math.max(s.z0, s.z1) + m - bounds.minZ) / pzm));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = bounds.minX + (c + 0.5) * pxm - mx, z = bounds.minZ + (r + 0.5) * pzm - mz;
      // the side of the center line is kept as a sign: a straight ramp through zero survives
      // the texture filter, a V shaped absolute value does not
      const al = Math.abs(x * ux + z * uz), pe = -x * uz + z * ux;
      const qa = al - hl, qp = Math.abs(pe) - s.hw;
      const d = Math.hypot(Math.max(qa, 0), Math.max(qp, 0)) + Math.min(Math.max(qa, qp), 0);
      const i = r * N + c;
      if (d < sd1[i]) { sd2[i] = sd1[i]; sd1[i] = d; cd[i] = qa < 0 ? pe : far; hwm[i] = s.rows ? s.hw : -s.hw; } else if (d < sd2[i]) sd2[i] = d;
    }
  }
  const data = new Uint16Array(N * N * 4);
  const hf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < N * N; i++) { data[i * 4] = hf(sd1[i]); data[i * 4 + 1] = hf(cd[i]); data[i * 4 + 2] = hf(sd2[i]); data[i * 4 + 3] = hf(hwm[i]); }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const sdAt = (x, z) => {
    const c = Math.floor((x - bounds.minX) / pxm), r = Math.floor((z - bounds.minZ) / pzm);
    return c < 0 || r < 0 || c >= N || r >= N ? far : sd1[r * N + c];
  };
  return { segments, texture, angle, length, sdAt, rect: { minX: bounds.minX, minZ: bounds.minZ, w: W, h: H }, ms: Math.round(performance.now() - t0) };
}
