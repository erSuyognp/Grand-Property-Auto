// The 3D neighborhood: aerial ground image on a terrain mesh, extruded footprints with the
// aerial projected onto roofs, instanced trees and pools, sky, sun, fog, and the collision
// and navigation grids every other system uses.
import * as THREE from 'three';
import { makeProjection } from './geo.js';
import { dataBase, loadDataJson } from './data.js';
import { buildRoads } from './roads.js';
import { facadeMaterials, pitchedRoof, treeGeometry, treeMaterials, foliageTexture, lampGeometry, glowTexture, groundMaterial } from './worldgfx.js';

const WALLS = [0xe6d5b8, 0xd9c7a8, 0xcfd3d6, 0xe9e0cf, 0xd6b99a, 0xbfc8c2, 0xe2cdb9, 0xc9b8a6, 0xf0e6d6, 0xb9aea0];
const CELL = 4; // meters per nav / occupancy cell

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image ' + url));
    img.src = url;
  });
}

export async function createWorld(ctx, city) {
  const { scene, renderer } = ctx;
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];

  const [area, groundMeta, terrain, buildingsGeo, scatter, listings, commercial, nearby, splats] = await Promise.all([
    loadDataJson(city, 'area.json'),
    loadDataJson(city, 'ground.json'),
    loadDataJson(city, 'terrain.json').catch(() => null),
    loadDataJson(city, 'buildings.geojson'),
    loadDataJson(city, 'scatter.json').catch(() => ({ trees: [], pools: [] })),
    loadDataJson(city, 'listings.json'),
    loadDataJson(city, 'commercial.json').catch(() => []),
    loadDataJson(city, 'nearby.json').catch(() => ({})),
    loadDataJson(city, 'splats.json').catch(() => ({})),
  ]);
  const base = area.mock ? '/data/mock/' : dataBase(city);
  const proj = makeProjection(area.center);
  const [w, s, e, n] = area.bbox;
  const sw = proj.toLocal(s, w), ne = proj.toLocal(n, e);
  const bounds = { minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z };

  // ---- ground image (8k when the GPU allows, else 4k)
  const maxTex = renderer.capabilities.maxTextureSize;
  const low = ctx.quality.low || maxTex < 8192;
  let img;
  try {
    img = await loadImage(base + (low ? 'ground_4k.jpg' : 'ground.jpg'));
  } catch {
    img = await loadImage(base + 'ground.jpg');
  }
  const groundTex = new THREE.Texture(img);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  groundTex.needsUpdate = true;
  disposables.push(groundTex);
  const [gw, gs, ge, gn] = groundMeta.bounds;
  const gsw = proj.toLocal(gs, gw), gne = proj.toLocal(gn, ge);
  const G = { minX: gsw.x, maxX: gne.x, minZ: gne.z, maxZ: gsw.z };
  const uvAt = (x, z) => [(x - G.minX) / (G.maxX - G.minX), 1 - (z - G.minZ) / (G.maxZ - G.minZ)];

  // small copy of the aerial for the minimap and the road detector
  const mini = document.createElement('canvas');
  mini.width = mini.height = 1024;
  mini.getContext('2d').drawImage(img, 0, 0, 1024, 1024);

  // ---- terrain
  const tn = terrain ? terrain.n : 2;
  const tz = terrain && !terrain.flat ? terrain.z : null;
  function heightAt(x, z) {
    if (!tz) return 0;
    const fx = THREE.MathUtils.clamp((x - bounds.minX) / (bounds.maxX - bounds.minX), 0, 1) * (tn - 1);
    const fz = THREE.MathUtils.clamp((z - bounds.minZ) / (bounds.maxZ - bounds.minZ), 0, 1) * (tn - 1);
    const x0 = Math.min(tn - 2, Math.floor(fx)), z0 = Math.min(tn - 2, Math.floor(fz));
    const ax = fx - x0, az = fz - z0;
    const i = z0 * tn + x0;
    return (tz[i] * (1 - ax) + tz[i + 1] * ax) * (1 - az) + (tz[i + tn] * (1 - ax) + tz[i + tn + 1] * ax) * az;
  }

  const SEG = tz ? 96 : 1;
  const groundGeo = new THREE.PlaneGeometry(G.maxX - G.minX, G.maxZ - G.minZ, SEG, SEG);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate((G.minX + G.maxX) / 2, 0, (G.minZ + G.maxZ) / 2);
  if (tz) {
    const p = groundGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    groundGeo.computeVertexNormals();
  }
  const groundLook = groundMaterial(groundTex);
  disposables.push(groundLook.detail);
  const ground = new THREE.Mesh(groundGeo, groundLook.mat);
  ground.receiveShadow = true;
  group.add(ground);
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x66735c, roughness: 1 }));
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.6;
  group.add(skirt);

  // ---- buildings
  const listingByBuilding = new Map();
  for (const l of listings) {
    if (!listingByBuilding.has(l.buildingId)) listingByBuilding.set(l.buildingId, []);
    listingByBuilding.get(l.buildingId).push(l);
  }
  const buildings = [];
  const parts = { roof: [], stucco: [], siding: [], brick: [], office: [], glass: [] }; // geometry buckets
  const push = (bucket, pos, nor, uv, col) => bucket.push({ pos, nor, uv, col });
  const color = new THREE.Color();
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (const f of buildingsGeo.features) {
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
    if (!ring || ring.length < 4) continue;
    const pts = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const q = proj.toLocal(ring[i][1], ring[i][0]);
      pts.push(new THREE.Vector2(q.x, q.z));
    }
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0, gMin = Infinity, gMax = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
      cx += p.x / pts.length; cz += p.y / pts.length;
      const g = heightAt(p.x, p.y);
      gMin = Math.min(gMin, g); gMax = Math.max(gMax, g);
    }
    const P = f.properties;
    const h = P.h || 6;
    const top = gMax + h, bottom = gMin - 0.5;
    const hot = listingByBuilding.has(P.id);
    const b = { id: P.id, pts, minX, maxX, minZ, maxZ, cx, cz, h, top, props: P, listings: listingByBuilding.get(P.id) || [] };
    buildings.push(b);

    // roof: the aerial image projected straight down. Houses get slopes with eaves, everything
    // else a flat roof behind a parapet.
    const house = h <= 13 && P.roofShape !== 'flat';
    const pitched = house ? pitchedRoof(pts, top, h) : null;
    const rp = [], rn = [], ru = [], rc = [];
    let wallTop = top;
    if (pitched) {
      wallTop = pitched.eave + 0.06;
      for (let i = 0; i < pitched.pos.length; i += 3) {
        rp.push(pitched.pos[i], pitched.pos[i + 1], pitched.pos[i + 2]);
        rn.push(pitched.nor[i], pitched.nor[i + 1], pitched.nor[i + 2]);
        const uv = uvAt(pitched.pos[i], pitched.pos[i + 2]);
        ru.push(uv[0], uv[1]); rc.push(1, 1, 1);
      }
    } else {
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      for (const t of tris) {
        for (const k of [t[0], t[2], t[1]]) {
          const p = pts[k];
          rp.push(p.x, top, p.y); rn.push(0, 1, 0);
          const uv = uvAt(p.x, p.y);
          ru.push(uv[0], uv[1]); rc.push(1, 1, 1);
        }
      }
      wallTop = top + (h > 7 ? 0.7 : 0.35); // parapet
    }
    push(parts.roof, rp, rn, ru, rc);

    // walls
    const tall = h > 13;
    const pick = rand();
    const style = h > 32 ? 'glass' : tall ? (pick < 0.7 ? 'office' : 'glass') : house ? (pick < 0.5 ? 'stucco' : pick < 0.8 ? 'siding' : 'brick') : (pick < 0.55 ? 'brick' : 'stucco');
    color.setHex(WALLS[Math.floor(rand() * WALLS.length)]);
    if (style === 'glass') color.lerp(new THREE.Color(0x9fb4c6), 0.7);
    else if (style === 'office') color.lerp(new THREE.Color(0xc9ccce), 0.5);
    else if (style === 'brick') color.lerp(new THREE.Color(rand() < 0.6 ? 0xa8674f : 0xb9a189), 0.6);
    color.multiplyScalar(0.9 + rand() * 0.2);
    if (hot) { color.r = Math.min(1, color.r * 1.06); color.b *= 0.92; }
    const wp = [], wn = [], wu = [], wc = [];
    const floors = Math.max(1, Math.round((wallTop - bottom - 0.5) / 3.1));
    const uShift = Math.floor(rand() * 4), vShift = Math.floor(rand() * 4);
    const v0 = vShift / 4, v1 = (vShift + floors) / 4;
    const dark = tall ? 0.9 : 0.8;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c.x - a.x, dz = c.y - a.y;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      // short returns show plain wall (the strip between two windows), long runs get bays
      const bays = Math.round(len / 3.6);
      const u0 = bays ? (uShift + i) / 4 : 0.01, u1 = bays ? u0 + bays / 4 : 0.05;
      wp.push(a.x, bottom, a.y, c.x, wallTop, c.y, c.x, bottom, c.y, a.x, bottom, a.y, a.x, wallTop, a.y, c.x, wallTop, c.y);
      for (let k = 0; k < 6; k++) wn.push(nx, 0, nz);
      wu.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
      for (const m of [dark, 1, dark, dark, 1, 1]) wc.push(color.r * m, color.g * m, color.b * m);
      if (!pitched) { // inside face of the parapet
        wp.push(a.x, top, a.y, c.x, top, c.y, c.x, wallTop, c.y, a.x, top, a.y, c.x, wallTop, c.y, a.x, wallTop, a.y);
        for (let k = 0; k < 6; k++) { wn.push(-nx, 0, -nz); wu.push(0.01, 0.01); wc.push(color.r * 0.7, color.g * 0.7, color.b * 0.7); }
      }
    }
    push(parts[style], wp, wn, wu, wc);
  }

  function merge(bucket) {
    let n = 0;
    for (const b of bucket) n += b.pos.length / 3;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    let o = 0;
    for (const b of bucket) {
      pos.set(b.pos, o * 3); nor.set(b.nor, o * 3); uv.set(b.uv, o * 2); col.set(b.col, o * 3);
      o += b.pos.length / 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  const facades = facadeMaterials(renderer);
  disposables.push(...facades.textures);
  const mats = { roof: new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.88, metalness: 0 }), ...facades.mats };
  for (const key of Object.keys(parts)) {
    if (!parts[key].length) continue;
    const mesh = new THREE.Mesh(merge(parts[key]), mats[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'buildings-' + key;
    group.add(mesh);
  }

  // ---- trees: one shaded model, instanced in chunks so off-screen blocks are skipped
  const dummy = new THREE.Object3D();
  const trees = scatter.trees || [];
  if (trees.length) {
    const treeGeo = treeGeometry();
    const leafTex = foliageTexture();
    disposables.push(leafTex);
    const treeLook = treeMaterials(leafTex);
    const treeMat = treeLook.mat;
    const K = 6, chunks = new Map();
    trees.forEach((t, i) => {
      const q = proj.toLocal(t[1], t[0]);
      const cxk = Math.min(K - 1, Math.max(0, Math.floor(((q.x - bounds.minX) / (bounds.maxX - bounds.minX)) * K)));
      const czk = Math.min(K - 1, Math.max(0, Math.floor(((q.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * K)));
      const key = czk * K + cxk;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push({ x: q.x, z: q.z, s: t[2] || 1, i });
    });
    for (const list of chunks.values()) {
      const mesh = new THREE.InstancedMesh(treeGeo, treeMat, list.length);
      list.forEach((t, k) => {
        const wob = 0.85 + (((t.i * 37) % 100) / 100) * 0.4, tallness = 0.85 + (((t.i * 53) % 100) / 100) * 0.45;
        dummy.position.set(t.x, heightAt(t.x, t.z) - 0.1, t.z);
        dummy.rotation.set(0, t.i * 1.7, 0);
        dummy.scale.set(t.s * wob, t.s * tallness, t.s * wob);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        const hue = ((t.i * 29) % 100) / 100;
        mesh.setColorAt(k, color.setRGB(0.82 + hue * 0.3, 0.86 + (((t.i * 13) % 100) / 100) * 0.24, 0.8 + hue * 0.2));
      });
      mesh.customDepthMaterial = treeLook.depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  const pools = scatter.pools || [];
  if (pools.length) {
    const poolGeo = new THREE.CircleGeometry(1, 20);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMesh = new THREE.InstancedMesh(poolGeo, new THREE.MeshStandardMaterial({ color: 0x2aa6d8, roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.9 }), pools.length);
    pools.forEach((p, i) => {
      const q = proj.toLocal(p[1], p[0]);
      const r = Math.max(1.6, Math.sqrt((p[2] || 30) / Math.PI));
      dummy.position.set(q.x, heightAt(q.x, q.z) + 0.12, q.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r * 1.25, 1, r * 0.8);
      dummy.updateMatrix();
      poolMesh.setMatrixAt(i, dummy.matrix);
    });
    group.add(poolMesh);
  }

  // ---- occupancy grid (blocked = inside a building) and a road-likeness cost from the aerial
  const cols = Math.ceil((bounds.maxX - bounds.minX) / CELL), rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL);
  const blocked = new Uint8Array(cols * rows);
  const bucketSize = 24;
  const bcols = Math.ceil((bounds.maxX - bounds.minX) / bucketSize) + 1, brows = Math.ceil((bounds.maxZ - bounds.minZ) / bucketSize) + 1;
  const buckets = new Map();
  const bkey = (ix, iz) => iz * bcols + ix;
  function pointIn(b, x, z) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    let inside = false;
    const p = b.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i].y > z) !== (p[j].y > z) && x < ((p[j].x - p[i].x) * (z - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
    }
    return inside;
  }
  for (const b of buildings) {
    const x0 = Math.floor((b.minX - bounds.minX) / bucketSize), x1 = Math.floor((b.maxX - bounds.minX) / bucketSize);
    const z0 = Math.floor((b.minZ - bounds.minZ) / bucketSize), z1 = Math.floor((b.maxZ - bounds.minZ) / bucketSize);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const k = bkey(ix, iz);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
    const c0 = Math.max(0, Math.floor((b.minX - bounds.minX - 1.5) / CELL)), c1 = Math.min(cols - 1, Math.floor((b.maxX - bounds.minX + 1.5) / CELL));
    const r0 = Math.max(0, Math.floor((b.minZ - bounds.minZ - 1.5) / CELL)), r1 = Math.min(rows - 1, Math.floor((b.maxZ - bounds.minZ + 1.5) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = bounds.minX + (c + 0.5) * CELL, z = bounds.minZ + (r + 0.5) * CELL;
      if (pointIn(b, x, z) || pointIn(b, x - 1.6, z) || pointIn(b, x + 1.6, z) || pointIn(b, x, z - 1.6) || pointIn(b, x, z + 1.6)) blocked[r * cols + c] = 1;
    }
  }
  function nearBuildings(x, z) {
    return buckets.get(bkey(Math.floor((x - bounds.minX) / bucketSize), Math.floor((z - bounds.minZ) / bucketSize))) || [];
  }
  function buildingAt(x, z) {
    for (const b of nearBuildings(x, z)) if (pointIn(b, x, z)) return b;
    return null;
  }
  // road-likeness: gray, mid-bright pixels in the aerial
  const cost = new Float32Array(cols * rows);
  {
    const small = document.createElement('canvas');
    small.width = cols; small.height = rows;
    const g = small.getContext('2d', { willReadFrequently: true });
    const u0 = uvAt(bounds.minX, bounds.minZ), u1 = uvAt(bounds.maxX, bounds.maxZ);
    g.drawImage(img, u0[0] * img.width, (1 - u0[1]) * img.height, (u1[0] - u0[0]) * img.width, (u0[1] - u1[1]) * img.height, 0, 0, cols, rows);
    const d = g.getImageData(0, 0, cols, rows).data;
    for (let i = 0; i < cols * rows; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], bl = d[i * 4 + 2];
      const mx = Math.max(r, gg, bl), mn = Math.min(r, gg, bl);
      const road = mx - mn < 26 && mx > 55 && mx < 190;
      cost[i] = road ? 1 : 3.2;
    }
  }
  // ---- streets traced from the photo: they get real surfaces, and routes, traffic, lamps
  // and the spawn point use them instead of "anything gray"
  let roads = null;
  if (!ctx.params.has('noroads')) {
    try { roads = buildRoads({ img, uvAt, G, bounds, buildings }); } catch (e) { console.warn('[roads]', e.message); }
  }
  if (roads) {
    groundLook.setRoads(roads);
    disposables.push(roads.texture);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const sd = roads.sdAt(bounds.minX + (c + 0.5) * CELL, bounds.minZ + (r + 0.5) * CELL);
      cost[i] = sd < -1 ? 1 : cost[i] <= 1 ? 1.9 : 4;
    }
  }
  window.__gpa.roads = roads ? { streets: roads.segments.length, meters: Math.round(roads.length), angle: +((roads.angle * 180) / Math.PI).toFixed(1), ms: roads.ms } : null;

  // connected areas of free cells: routes and spawns stay in the largest one, so a courtyard
  // or a gap sealed off by buildings is never chosen as a start or a goal
  const comp = new Int32Array(cols * rows);
  let mainComp = 0;
  {
    let label = 0, bestSize = 0;
    const stack = [];
    for (let i0 = 0; i0 < cols * rows; i0++) {
      if (blocked[i0] || comp[i0]) continue;
      label++;
      let size = 0;
      stack.push(i0); comp[i0] = label;
      while (stack.length) {
        const i = stack.pop();
        size++;
        const c = i % cols, r = (i - c) / cols;
        if (c > 0 && !blocked[i - 1] && !comp[i - 1]) { comp[i - 1] = label; stack.push(i - 1); }
        if (c < cols - 1 && !blocked[i + 1] && !comp[i + 1]) { comp[i + 1] = label; stack.push(i + 1); }
        if (r > 0 && !blocked[i - cols] && !comp[i - cols]) { comp[i - cols] = label; stack.push(i - cols); }
        if (r < rows - 1 && !blocked[i + cols] && !comp[i + cols]) { comp[i + cols] = label; stack.push(i + cols); }
      }
      if (size > bestSize) { bestSize = size; mainComp = label; }
    }
  }
  const isFree = (x, z) => {
    const c = Math.floor((x - bounds.minX) / CELL), r = Math.floor((z - bounds.minZ) / CELL);
    return c >= 0 && r >= 0 && c < cols && r < rows && !blocked[r * cols + c];
  };
  function findSpawn(x0 = 0, z0 = 0) {
    let best = null, bestScore = Infinity;
    for (let r = 2; r < rows - 2; r++) for (let c = 2; c < cols - 2; c++) {
      const i = r * cols + c;
      if (blocked[i] || cost[i] > 1 || comp[i] !== mainComp) continue;
      let clear = true;
      for (let dr = -1; dr <= 1 && clear; dr++) for (let dc = -1; dc <= 1; dc++) if (blocked[i + dr * cols + dc] || cost[i + dr * cols + dc] > 1) { clear = false; break; }
      if (!clear) continue;
      const x = bounds.minX + (c + 0.5) * CELL, z = bounds.minZ + (r + 0.5) * CELL;
      const d = Math.hypot(x - x0, z - z0);
      if (d < bestScore) { bestScore = d; best = { x, z }; }
    }
    if (best) return best;
    for (let rad = 0; rad < 400; rad += CELL) for (let a = 0; a < 6.28; a += 0.3) {
      const x = x0 + Math.cos(a) * rad, z = z0 + Math.sin(a) * rad;
      if (isFree(x, z)) return { x, z };
    }
    return { x: x0, z: z0 };
  }

  // ---- street lamps on the edge of what looks like road, lit at night
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(glowMat.map);
  {
    const spots = [];
    const STEP = 7;
    for (let r = 3; r < rows - 3 && spots.length < 420; r += STEP) for (let c = 3 + ((r / STEP) % 2) * 3; c < cols - 3 && spots.length < 420; c += STEP) {
      const i = r * cols + c;
      if (blocked[i] || cost[i] > 1) continue;
      // walk to the nearest non-road, free cell: that is the kerb
      let found = null;
      for (let rad = 1; rad <= 3 && !found; rad++) for (const [dc, dr] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) {
        const j = (r + dr) * cols + (c + dc);
        if (!blocked[j] && cost[j] > 1) { found = { c: c + dc, r: r + dr, dc, dr }; break; }
      }
      if (!found) continue;
      const x = bounds.minX + (found.c + 0.5) * CELL - Math.sign(found.dc) * 1.4, z = bounds.minZ + (found.r + 0.5) * CELL - Math.sign(found.dr) * 1.4;
      if (buildingAt(x, z)) continue;
      spots.push({ x, z, a: Math.atan2(found.dc, found.dr) }); // arm reaches back over the road
    }
    if (spots.length) {
      const lg = lampGeometry();
      const poles = new THREE.InstancedMesh(lg.pole, new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.6, metalness: 0.7 }), spots.length);
      const heads = new THREE.InstancedMesh(lg.head, lampHeadMat, spots.length);
      const glowGeo = new THREE.PlaneGeometry(22, 22);
      glowGeo.rotateX(-Math.PI / 2);
      const glows = new THREE.InstancedMesh(glowGeo, glowMat, spots.length);
      spots.forEach((p, k) => {
        const y = heightAt(p.x, p.z);
        dummy.position.set(p.x, y, p.z);
        dummy.rotation.set(0, p.a, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(k, dummy.matrix);
        heads.setMatrixAt(k, dummy.matrix);
        dummy.position.set(p.x - Math.sin(p.a) * 1.5, y + 0.2, p.z - Math.cos(p.a) * 1.5);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        glows.setMatrixAt(k, dummy.matrix);
      });
      poles.castShadow = true;
      glows.renderOrder = 2;
      glows.name = 'lamp-glow';
      poles.computeBoundingSphere(); heads.computeBoundingSphere(); glows.computeBoundingSphere();
      group.add(poles, heads, glows);
    }
  }
  let lastNight = -1;

  const world = {
    city, area, proj, bounds, group, buildings, listings, commercial, nearby, base, mini, G, uvAt, roads,
    heightAt, buildingAt, nearBuildings, pointIn, isFree, findSpawn,
    grid: { cols, rows, cell: CELL, blocked, cost, comp, mainComp },
    listingByBuilding,
    update() {
      // windows and lamps come on as the light goes
      const night = ctx.env ? ctx.env.state.night : 0;
      if (Math.abs(night - lastNight) < 0.004) return;
      lastNight = night;
      const lit = THREE.MathUtils.smoothstep(night, 0.15, 0.9);
      for (const m of Object.values(facades.mats)) m.emissiveIntensity = lit * 1.5;
      lampHeadMat.emissiveIntensity = lit * 6;
      glowMat.opacity = lit * 0.55;
    },
    // the Google 3D city replaces what is drawn; the data underneath stays
    setCityVisible(on) { for (const o of group.children) o.visible = on; },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      disposables.forEach((d) => d.dispose());
    },
  };
  // local coordinates for every listing and commercial property
  for (const l of listings) {
    const q = proj.toLocal(l.lat, l.lon);
    l.x = q.x; l.z = q.z;
    if (splats && splats[l.id] && !area.mock) l.splat = splats[l.id]; // exterior drone splat (src/drone.js)
  }
  for (const c of commercial) {
    const q = proj.toLocal(c.lat, c.lon);
    c.x = q.x; c.z = q.z;
  }
  return world;
}
