// Rails: walking a home along a smooth curve through its scan positions. Shared by both
// viewers (the Showcase camera component in src/showcaseRail.js and our own viewer in
// src/walk.js).
//
// - The graph: scan positions at eye height, joined only where the scan data says two
//   positions are neighbors, so the route never cuts through a wall.
// - The route: a walk of that graph from the start position that visits every position it
//   can reach, going to the nearest unvisited neighbor and backing up along its own steps
//   when it runs out.
// - The rail: a centripetal Catmull-Rom curve through the route.
// - The rider: W/S move along the rail with acceleration, A/D choose a branch at a junction,
//   and after a short pause it eases onto the nearest scan position and reports "settled".
import * as THREE from 'three';

const WALK = 1.2, RUN = 2.5, ACCEL = 3.2, SETTLE_AFTER = 0.4;

// nodes: [{ id, pos: {x, y, z}, neighbors: [id], floor }]
export function buildGraph(nodes) {
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, { id: n.id, pos: new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z), floor: n.floor, room: n.room, links: new Set(), data: n.data });
  for (const n of nodes) {
    for (const m of n.neighbors || []) {
      const a = byId.get(n.id), b = byId.get(m);
      if (!a || !b || a === b) continue;
      const d = a.pos.distanceTo(b.pos);
      if (d < 0.15 || d > 9 || Math.abs(a.pos.y - b.pos.y) > 2.4) continue; // a real step, stairs included
      a.links.add(b.id); b.links.add(a.id);
    }
  }
  return byId;
}

// the pieces of the graph that are joined together, largest first
export function components(graph) {
  const seen = new Set(), out = [];
  for (const id of graph.keys()) {
    if (seen.has(id)) continue;
    const comp = [], stack = [id];
    seen.add(id);
    while (stack.length) { const c = stack.pop(); comp.push(c); for (const l of graph.get(c).links) if (!seen.has(l)) { seen.add(l); stack.push(l); } }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

// Walk from `start`: always to the nearest unvisited neighbor that keeps us going roughly the
// way we were going, backing up along our own steps when there is none. `first` forces the
// first step (a branch the player chose); `from` is where we came from, to avoid doubling back.
export function planRoute(graph, start, { first = null, from = null, visited = new Set() } = {}) {
  const route = [start];
  const seen = new Set(visited);
  seen.add(start);
  const trail = [start];
  let prev = from, cur = start, forced = first;
  for (let guard = 0; guard < graph.size * 4; guard++) {
    const node = graph.get(cur);
    let next = null;
    if (forced && node.links.has(forced)) { next = forced; forced = null; } else {
      let best = Infinity;
      const pv = prev ? graph.get(prev).pos : null;
      for (const l of node.links) {
        if (seen.has(l)) continue;
        const p = graph.get(l).pos;
        let cost = node.pos.distanceTo(p);
        if (pv) { // prefer carrying on over turning back on ourselves
          const ax = node.pos.x - pv.x, az = node.pos.z - pv.z, bx = p.x - node.pos.x, bz = p.z - node.pos.z;
          const dot = (ax * bx + az * bz) / ((Math.hypot(ax, az) || 1) * (Math.hypot(bx, bz) || 1));
          cost *= 1.35 - 0.35 * dot;
        }
        if (cost < best) { best = cost; next = l; }
      }
    }
    if (next) { seen.add(next); route.push(next); trail.push(next); prev = cur; cur = next; continue; }
    // nothing new from here: back up one step, unless everything reachable has been seen
    let more = false;
    for (const t of trail) { for (const l of graph.get(t).links) if (!seen.has(l)) { more = true; break; } if (more) break; }
    if (!more || trail.length < 2) break;
    trail.pop();
    prev = cur; cur = trail[trail.length - 1];
    route.push(cur);
  }
  return route;
}

// shortest way along the graph from a to b (a list of ids, a first), or null
export function shortestPath(graph, a, b) {
  const dist = new Map([[a, 0]]), prev = new Map(), open = new Set([a]);
  while (open.size) {
    let cur = null, best = Infinity;
    for (const id of open) { const d = dist.get(id); if (d < best) { best = d; cur = id; } }
    open.delete(cur);
    if (cur === b) break;
    const node = graph.get(cur);
    for (const l of node.links) {
      const nd = best + node.pos.distanceTo(graph.get(l).pos);
      if (nd < (dist.get(l) ?? Infinity)) { dist.set(l, nd); prev.set(l, cur); open.add(l); }
    }
  }
  if (!dist.has(b)) return null;
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0]));
  return path;
}

// The tour: not every scan position, just a spread of the home. Pick positions far apart
// from each other, visit them nearest first along the graph, and keep the walk under maxLen
// meters by picking fewer if needed.
export function planTour(graph, start, maxLen = 95) {
  const reach = new Set(planRoute(graph, start));
  const far = (from, chosen) => {
    let best = null, bd = -1;
    for (const id of reach) {
      if (chosen.includes(id)) continue;
      const d = Math.min(...chosen.map((c) => graph.get(c).pos.distanceTo(graph.get(id).pos)));
      if (d > bd) { bd = d; best = id; }
    }
    return best;
  };
  for (let k = Math.min(9, reach.size - 1); k >= 1; k--) {
    const chosen = [start];
    while (chosen.length <= k) { const f = far(start, chosen); if (!f) break; chosen.push(f); }
    const todo = chosen.slice(1), route = [start];
    let cur = start, len = 0, ok = true;
    while (todo.length) {
      let bestPath = null, bi = -1, bl = Infinity;
      todo.forEach((t, i) => {
        const p = shortestPath(graph, cur, t);
        if (!p) return;
        let l = 0;
        for (let j = 1; j < p.length; j++) l += graph.get(p[j - 1]).pos.distanceTo(graph.get(p[j]).pos);
        if (l < bl) { bl = l; bestPath = p; bi = i; }
      });
      if (!bestPath) { ok = false; break; }
      route.push(...bestPath.slice(1));
      len += bl; cur = todo[bi]; todo.splice(bi, 1);
    }
    if (ok && (len <= maxLen || k === 1)) return route;
  }
  return planRoute(graph, start);
}

class Rail {
  constructor(graph, route) {
    this.route = route;
    this.pts = route.map((id) => graph.get(id).pos);
    const pts = this.pts.length > 1 ? this.pts : [this.pts[0], this.pts[0].clone().add(new THREE.Vector3(0.01, 0, 0))];
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    // arc length table: K samples per span; the curve passes node i at t = i / (n - 1)
    const K = 14, n = pts.length, total = (n - 1) * K;
    this.table = new Float32Array(total + 1);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.curve.getPoint(0, a);
    for (let i = 1; i <= total; i++) { this.curve.getPoint(i / total, b); this.table[i] = this.table[i - 1] + a.distanceTo(b); a.copy(b); }
    this.K = K; this.total = total; this.length = this.table[total];
  }
  sOfNode(i) { return this.table[Math.min(this.total, i * this.K)]; }
  tOf(s) {
    const tb = this.table;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = this.total;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tb[mid] <= s) lo = mid; else hi = mid; }
    const span = tb[hi] - tb[lo] || 1;
    return (lo + (s - tb[lo]) / span) / this.total;
  }
  point(s, out) { return this.curve.getPoint(this.tOf(s), out); }
  tangent(s, out) { return this.curve.getTangent(this.tOf(s), out); }
  // index of the route node nearest to arc length s
  nodeNear(s) {
    const i = Math.round(this.tOf(s) * (this.pts.length - 1));
    return Math.max(0, Math.min(this.route.length - 1, i));
  }
}

export function createRider(graph, startId) {
  const R = {
    graph, rail: new Rail(graph, planRoute(graph, startId)), s: 0, v: 0, yaw: 0, yawOff: 0, pitch: 0,
    settled: true, idle: 0, node: startId, auto: null, moved: 0, pos: new THREE.Vector3(), lastBranch: 0, visited: new Set([startId]),
  };
  const tan = new THREE.Vector3();
  R.rail.point(0, R.pos);
  R.rail.tangent(0.05, tan);
  R.yaw = Math.atan2(-tan.x, -tan.z);

  function replan(index, opts) {
    // keep the rail behind us, lay new rail from the node at `index`
    const keep = R.rail.route.slice(0, index + 1);
    const node = keep[keep.length - 1];
    const tail = planRoute(graph, node, { ...opts, from: keep.length > 1 ? keep[keep.length - 2] : null, visited: opts.fresh ? new Set() : R.visited });
    const before = R.rail.sOfNode(index) - R.s;
    R.rail = new Rail(graph, keep.concat(tail.slice(1)));
    R.s = Math.max(0, R.rail.sOfNode(index) - before);
  }

  // junction choice: at the next node ahead (or the one we stand on), take the exit to the
  // left (-1) or right (+1) of the one currently planned
  function branch(side) {
    const i = R.rail.nodeNear(R.s + (R.v >= 0 ? 0.6 : -0.6));
    const id = R.rail.route[i], node = graph.get(id);
    const cameFrom = i > 0 ? R.rail.route[i - 1] : null;
    const exits = [...node.links].filter((l) => l !== cameFrom);
    if (exits.length < 2) return false;
    const base = cameFrom ? graph.get(cameFrom).pos : node.pos.clone().sub(new THREE.Vector3(-Math.sin(R.yaw), 0, -Math.cos(R.yaw)));
    const inAng = Math.atan2(node.pos.x - base.x, node.pos.z - base.z);
    const ang = (l) => { const p = graph.get(l).pos; let a = Math.atan2(p.x - node.pos.x, p.z - node.pos.z) - inAng; return Math.atan2(Math.sin(a), Math.cos(a)); };
    exits.sort((a, b) => ang(a) - ang(b)); // +angle = toward +x when heading +z: our left in the y up, -z forward view
    const planned = R.rail.route[i + 1];
    let k = exits.indexOf(planned);
    if (k < 0) k = exits.reduce((bi, l, j) => (Math.abs(ang(l)) < Math.abs(ang(exits[bi])) ? j : bi), 0);
    const pickIdx = Math.max(0, Math.min(exits.length - 1, k + (side < 0 ? 1 : -1)));
    if (exits[pickIdx] === planned) return false;
    replan(i, { first: exits[pickIdx] });
    R.branched = exits[pickIdx];
    return true;
  }

  // input: { move: -1..1, run: bool, branch: -1 | 0 | 1 }
  function update(dt, input) {
    const rail0 = R.rail;
    const auto = R.auto;
    let move = auto ? 1 : Math.max(-1, Math.min(1, input.move || 0));
    if (input.branch && input.branch !== R.lastBranch) branch(input.branch);
    R.lastBranch = input.branch || 0;
    const top = auto ? auto.speed : input.run ? RUN : WALK;
    if (Math.abs(move) > 0.01) {
      R.idle = 0; R.settled = false;
      const want = move * top;
      R.v += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - R.v));
    } else {
      R.idle += dt;
      if (R.idle < SETTLE_AFTER) {
        R.v += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, -R.v)); // coast down
      } else if (!R.settled) {
        // ease onto the nearest scan position
        const i = R.rail.nodeNear(R.s), target = R.rail.sOfNode(i), gap = target - R.s;
        const want = Math.max(-WALK, Math.min(WALK, gap * 4.5));
        R.v += Math.max(-ACCEL * 2 * dt, Math.min(ACCEL * 2 * dt, want - R.v));
        if (Math.abs(gap) < 0.025 && Math.abs(R.v) < 0.12) { R.s = target; R.v = 0; R.settled = true; R.node = R.rail.route[i]; }
      }
    }
    const before = R.s;
    R.s = Math.max(0, Math.min(R.rail.length, R.s + R.v * dt));
    R.moved += Math.abs(R.s - before);
    if (R.s >= R.rail.length - 1e-4 && R.v > 0) {
      // end of the line: everything reachable has been walked. Lay a fresh round from here.
      if (auto) { R.auto = null; R.v = 0; R.done = true; } else { R.visited = new Set(); replan(R.rail.route.length - 1, { fresh: true }); if (R.rail.length - R.s < 0.05) R.v = 0; }
    }
    if (R.s <= 0 && R.v < 0) R.v = 0;
    const rail = R.rail;
    rail.point(R.s, R.pos);
    const near = rail.route[rail.nodeNear(R.s)];
    R.visited.add(near);
    R.near = near;
    // face along the rail (a little ahead, so turns begin before the corner); ease the turn
    if (rail.length > 0.2 && (Math.abs(R.v) > 0.05 || rail !== rail0)) {
      rail.tangent(Math.min(rail.length, R.s + 0.5), tan);
      if (tan.x * tan.x + tan.z * tan.z > 1e-6) {
        const want = Math.atan2(-tan.x, -tan.z);
        const d = Math.atan2(Math.sin(want - R.yaw), Math.cos(want - R.yaw));
        R.yaw += d * Math.min(1, dt * 3.2);
      }
    }
    if (auto) { auto.t += dt; R.yawOff = Math.sin(auto.t * 0.55) * 0.5; R.pitch = Math.sin(auto.t * 0.31) * 0.08; }
    return R;
  }

  return {
    state: R, update, branch,
    get heading() { return R.yaw + R.yawOff; },
    look(dx, dy) { R.yawOff += dx; R.pitch = Math.max(-1.25, Math.min(1.25, R.pitch + dy)); },
    // keep looking where the given heading points (used when taking over from another camera)
    faceHeading(yaw, pitch = 0) { R.yawOff = Math.atan2(Math.sin(yaw - R.yaw), Math.cos(yaw - R.yaw)); R.pitch = pitch; },
    // glide the whole route in about `seconds`
    startTour(seconds = 45) {
      R.visited = new Set();
      R.rail = new Rail(graph, planTour(graph, R.node || R.near || startId, seconds * 2.1));
      R.s = 0; R.v = 0; R.done = false; R.settled = false; R.idle = 0;
      R.auto = { speed: Math.max(0.6, Math.min(2.4, R.rail.length / seconds)), t: 0 };
      return R.rail.length;
    },
    stopTour() { R.auto = null; R.yawOff = 0; R.pitch = 0; },
    // stand on a given scan position with fresh rail laid from it
    resetAt(id) {
      if (!graph.has(id)) return false;
      R.rail = new Rail(graph, planRoute(graph, id));
      R.s = 0; R.v = 0; R.node = id; R.near = id; R.settled = true; R.idle = 0; R.auto = null; R.done = false;
      R.visited = new Set([id]);
      R.rail.point(0, R.pos);
      return true;
    },
    info() { return { s: +R.s.toFixed(2), v: +R.v.toFixed(2), length: +R.rail.length.toFixed(1), settled: R.settled, node: R.node, near: R.near, moved: +R.moved.toFixed(2), nodes: graph.size, route: R.rail.route.length, auto: !!R.auto }; },
  };
}
