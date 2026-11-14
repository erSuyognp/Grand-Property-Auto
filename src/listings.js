// Floating markers above every listing building: a slowly rotating house (or building) icon
// on a light beam. Green for sale, blue for rent, purple apartments, gray and smaller for
// recently sold. Sized by price, instanced. Also finds the listing the car is next to.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIND_COLOR, priceValue } from './format.js';

const KINDS = ['sale', 'rent', 'apartments', 'sold'];
const NEAR_M = 25;

function houseGeo() {
  const body = new THREE.BoxGeometry(2.2, 1.5, 2.2);
  const roof = new THREE.ConeGeometry(1.95, 1.3, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.4, 0);
  const door = new THREE.BoxGeometry(0.5, 0.9, 0.1);
  door.translate(0, -0.3, 1.12);
  return mergeGeometries([body, roof, door].map((g) => g.toNonIndexed()));
}
function towerGeo() {
  const a = new THREE.BoxGeometry(1.6, 3.2, 1.6);
  const b = new THREE.BoxGeometry(1.2, 2.2, 1.2);
  b.translate(1.3, -0.5, 0);
  const c = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  c.translate(0, 1.85, 0);
  return mergeGeometries([a, b, c].map((g) => g.toNonIndexed()));
}

function distToBuilding(b, x, z) {
  let best = Infinity;
  const p = b.pts;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    const ex = c.x - a.x, ez = c.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.y) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + ex * t), z - (a.y + ez * t)));
  }
  return best;
}

export function initListings(ctx) {
  const visible = { sale: true, rent: true, apartments: true, sold: true };
  let group = null, items = [], meshes = null, highlights = null, target = null, near = null, nearCommercial = null;
  const dummy = new THREE.Object3D(), col = new THREE.Color(), gray = new THREE.Color(0x59606b);
  let t = 0;

  function build(world) {
    group = new THREE.Group();
    world.group.add(group);
    const byId = new Map(world.buildings.map((b) => [b.id, b]));
    const prices = world.listings.filter((l) => l.kind === 'sale' || l.kind === 'sold').map((l) => Math.log(Math.max(1, priceValue(l)))).sort((a, b) => a - b);
    const lo = prices[0] || 12, hi = prices[prices.length - 1] || 14;
    const stack = new Map();
    items = world.listings.map((l) => {
      const b = byId.get(l.buildingId);
      const n = stack.get(l.buildingId) || 0;
      stack.set(l.buildingId, n + 1);
      const a = n * 2.4, r = n ? 5 + Math.floor(n / 6) * 4 : 0;
      const x = (b ? b.cx : l.x) + Math.cos(a) * r, z = (b ? b.cz : l.z) + Math.sin(a) * r;
      const top = b ? b.top : world.heightAt(x, z) + 6;
      let size = 1;
      if (l.kind === 'sale' || l.kind === 'sold') size = 0.85 + 0.75 * ((Math.log(Math.max(1, priceValue(l))) - lo) / Math.max(0.01, hi - lo));
      if (l.kind === 'apartments') size = 1.25;
      if (l.kind === 'sold') size *= 0.62;
      l.mx = x; l.mz = z; l.building = b;
      return { l, b, x, z, top, size, ground: world.heightAt(x, z) };
    });
    const count = Math.max(1, items.length);
    const iconMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25 });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const beamGeo = new THREE.CylinderGeometry(0.55, 0.9, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0);
    meshes = {
      house: new THREE.InstancedMesh(houseGeo(), iconMat, count),
      tower: new THREE.InstancedMesh(towerGeo(), iconMat, count),
      beam: new THREE.InstancedMesh(beamGeo, beamMat, count),
    };
    for (const m of Object.values(meshes)) { m.frustumCulled = false; group.add(m); }
    refresh();
  }

  function shown(it) {
    return visible[it.l.kind];
  }

  function refresh() {
    if (!meshes) return;
    items.forEach((it, i) => {
      const on = shown(it);
      const hl = highlights ? highlights.has(it.l.id) : true;
      const isTarget = target && target.id === it.l.id;
      col.set(KIND_COLOR[it.l.kind]);
      if (highlights && !hl) col.copy(gray);
      if (isTarget) col.set(0xffc940);
      for (const m of Object.values(meshes)) m.setColorAt(i, col);
      const beamH = (highlights && !hl ? 10 : 46) * (isTarget ? 2.6 : 1) * (it.l.kind === 'sold' ? 0.6 : 1);
      dummy.position.set(it.x, it.ground, it.z);
      dummy.rotation.set(0, 0, 0);
      const bw = on ? (isTarget ? 2.4 : highlights && !hl ? 0.35 : 1) * it.size : 0;
      dummy.scale.set(bw, on ? it.top - it.ground + beamH : 0, bw);
      dummy.updateMatrix();
      meshes.beam.setMatrixAt(i, dummy.matrix);
    });
    for (const m of Object.values(meshes)) { m.instanceColor.needsUpdate = true; m.instanceMatrix.needsUpdate = true; }
  }

  function update(dt) {
    if (!meshes) return;
    t += dt;
    const zero = 0.0001;
    items.forEach((it, i) => {
      const on = shown(it);
      const hl = highlights ? highlights.has(it.l.id) : true;
      const isTarget = target && target.id === it.l.id;
      let s = on ? it.size * (highlights && !hl ? 0.45 : 1) : zero;
      if (isTarget) s *= 1.5 + Math.sin(t * 5) * 0.15;
      else if (highlights && hl) s *= 1.15;
      const y = it.top + 4.5 * it.size + Math.sin(t * 1.6 + i) * 0.5;
      dummy.position.set(it.x, y, it.z);
      dummy.rotation.set(0, t * 0.9 + i, 0);
      const apt = it.l.kind === 'apartments';
      dummy.scale.setScalar(apt ? zero : s);
      dummy.updateMatrix();
      meshes.house.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(apt ? s : zero);
      dummy.updateMatrix();
      meshes.tower.setMatrixAt(i, dummy.matrix);
    });
    meshes.house.instanceMatrix.needsUpdate = true;
    meshes.tower.instanceMatrix.needsUpdate = true;

    // which listing (and which commercial property) is the car next to?
    const s = ctx.car.state;
    let best = null, bestD = NEAR_M;
    for (const it of items) {
      if (!shown(it)) continue;
      if (Math.abs(it.x - s.x) > 140 || Math.abs(it.z - s.z) > 140) continue;
      const d = it.b ? Math.min(distToBuilding(it.b, s.x, s.z), Math.hypot(it.x - s.x, it.z - s.z)) : Math.hypot(it.x - s.x, it.z - s.z);
      const bias = target && target.id === it.l.id ? -6 : it.l.kind === 'sold' ? 3 : 0;
      if (d + bias < bestD) { bestD = d + bias; best = it.l; }
    }
    if (best !== near) { near = best; ctx.emit('near-listing', near); }
    let bc = null;
    if (!near) {
      let bd = NEAR_M;
      for (const c of ctx.world.commercial) {
        if (Math.abs(c.x - s.x) > 160 || Math.abs(c.z - s.z) > 160) continue;
        const b = c.building || (c.building = ctx.world.buildings.find((x) => x.id === c.buildingId));
        const d = b ? distToBuilding(b, s.x, s.z) : Math.hypot(c.x - s.x, c.z - s.z);
        if (d < bd) { bd = d; bc = c; }
      }
    }
    if (bc !== nearCommercial) { nearCommercial = bc; ctx.emit('near-commercial', bc); }
  }

  ctx.on('city', (world) => { highlights = null; target = null; near = null; nearCommercial = null; build(world); });
  ctx.on('city-unload', () => { meshes = null; items = []; if (near) ctx.emit('near-listing', null); near = null; });
  ctx.on('update', (dt) => { if (ctx.state !== 'tour') update(dt); });

  const api = {
    KINDS, visible,
    get near() { return near; },
    get nearCommercial() { return nearCommercial; },
    get items() { return items; },
    toggle(kind) { visible[kind] = !visible[kind]; refresh(); ctx.emit('filters', visible); },
    setVisible(kind, on) { visible[kind] = on; refresh(); ctx.emit('filters', visible); },
    setHighlights(ids, tgt) { highlights = ids ? new Set(ids) : null; target = tgt || null; refresh(); },
    get target() { return target; },
    byId(id) { return ctx.world.listings.find((l) => l.id === id); },
  };
  return api;
}
