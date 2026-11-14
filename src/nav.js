// Route finding on the world's occupancy grid. Cells that look like road in the aerial image
// are cheap, yards cost more, buildings are blocked, so routes follow streets where they can.
export function findPath(world, from, to) {
  const { cols, rows, cell, blocked, cost, comp, mainComp } = world.grid;
  const open = (i) => !blocked[i] && (!comp || comp[i] === mainComp);
  const b = world.bounds;
  const toCell = (p) => [Math.max(0, Math.min(cols - 1, Math.floor((p.x - b.minX) / cell))), Math.max(0, Math.min(rows - 1, Math.floor((p.z - b.minZ) / cell)))];
  const nearestFree = ([c, r]) => {
    if (open(r * cols + c)) return [c, r];
    for (let rad = 1; rad < 60; rad++) {
      let best = null, bd = Infinity;
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows || !open(rr * cols + cc)) continue;
        const d = dr * dr + dc * dc + cost[rr * cols + cc];
        if (d < bd) { bd = d; best = [cc, rr]; }
      }
      if (best) return best;
    }
    return [c, r];
  };
  const [sc, sr] = nearestFree(toCell(from));
  const [tc, tr] = nearestFree(toCell(to));
  const start = sr * cols + sc, goal = tr * cols + tc;
  const g = new Float32Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  // binary heap of [f, index]
  const heapF = [], heapI = [];
  const push = (f, i) => {
    let n = heapF.length;
    heapF.push(f); heapI.push(i);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heapF[p] <= heapF[n]) break;
      [heapF[p], heapF[n]] = [heapF[n], heapF[p]]; [heapI[p], heapI[n]] = [heapI[n], heapI[p]];
      n = p;
    }
  };
  const pop = () => {
    const top = heapI[0];
    const lf = heapF.pop(), li = heapI.pop();
    if (heapF.length) {
      heapF[0] = lf; heapI[0] = li;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1, r = l + 1;
        let m = n;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === n) break;
        [heapF[m], heapF[n]] = [heapF[n], heapF[m]]; [heapI[m], heapI[n]] = [heapI[n], heapI[m]];
        n = m;
      }
    }
    return top;
  };
  const h = (i) => Math.hypot((i % cols) - tc, Math.floor(i / cols) - tr);
  g[start] = 0;
  push(h(start), start);
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false, guard = 0;
  while (heapF.length && guard++ < 400000) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { found = true; break; }
    const c = cur % cols, r = (cur - c) / cols;
    for (const [dc, dr, w] of DIRS) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const ni = rr * cols + cc;
      if (blocked[ni] || closed[ni]) continue;
      if (dc && dr && (blocked[r * cols + cc] || blocked[rr * cols + c])) continue; // no corner cutting
      const ng = g[cur] + w * cost[ni];
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ng + h(ni), ni); }
    }
  }
  const pts = [];
  if (!found) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
  for (let i = goal; i !== -1; i = came[i]) {
    const c = i % cols, r = (i - c) / cols;
    pts.push({ x: b.minX + (c + 0.5) * cell, z: b.minZ + (r + 0.5) * cell });
  }
  pts.reverse();
  // smooth: two passes of corner averaging, endpoints pinned
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i] = { x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4, z: (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4 };
    }
  }
  pts[0] = { x: from.x, z: from.z };
  return pts;
}

export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return d;
}
