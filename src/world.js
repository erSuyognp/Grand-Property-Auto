// The 3D neighborhood: aerial ground image on a terrain mesh, extruded footprints with the
// aerial projected onto roofs, instanced trees and pools, sky, sun, fog, and the collision
// and navigation grids every other system uses.
import * as THREE from 'three';
import { makeProjection } from './geo.js';
import { dataBase, loadDataJson } from './data.js';

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

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 120 + ((x * 7 + y * 13) % 5) * 12;
      g.fillStyle = `rgb(${v - 40},${v - 20},${v + 10})`;
      g.fillRect(x * 32 + 6, y * 32 + 8, 20, 17);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function houseTexture() {
  // one 3.2 m bay: stucco with a window, trim and a darker base course
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { const v = 236 + Math.floor(Math.random() * 19); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  g.fillStyle = '#f4f4f4'; g.fillRect(38, 30, 52, 58);
  g.fillStyle = '#6f8fa8'; g.fillRect(43, 35, 42, 48);
  g.fillStyle = '#f4f4f4'; g.fillRect(62, 35, 4, 48); g.fillRect(43, 57, 42, 4);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 112, 128, 16);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function skyDome() {
  const geo = new THREE.SphereGeometry(2600, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f86d8) }, mid: { value: new THREE.Color(0xa9d3f2) }, low: { value: new THREE.Color(0xf3e3c8) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y; vec3 c = mix(low, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.15, 0.85, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

export async function createWorld(ctx, city) {
  const { scene, renderer } = ctx;
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];

  const [area, groundMeta, terrain, buildingsGeo, scatter, listings, commercial, nearby] = await Promise.all([
    loadDataJson(city, 'area.json'),
    loadDataJson(city, 'ground.json'),
    loadDataJson(city, 'terrain.json').catch(() => null),
    loadDataJson(city, 'buildings.geojson'),
    loadDataJson(city, 'scatter.json').catch(() => ({ trees: [], pools: [] })),
    loadDataJson(city, 'listings.json'),
    loadDataJson(city, 'commercial.json').catch(() => []),
    loadDataJson(city, 'nearby.json').catch(() => ({})),
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
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.receiveShadow = true;
  group.add(ground);
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0x6f8466 }));
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
  const parts = { roof: [], wall: [], tower: [], hot: [] }; // geometry buckets
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

    // roof: triangulated footprint, UVs projected from the aerial image
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const rp = [], rn = [], ru = [], rc = [];
    for (const t of tris) {
      for (const k of [t[0], t[2], t[1]]) {
        const p = pts[k];
        rp.push(p.x, top, p.y); rn.push(0, 1, 0);
        const uv = uvAt(p.x, p.y);
        ru.push(uv[0], uv[1]); rc.push(1, 1, 1);
      }
    }
    push(parts.roof, rp, rn, ru, rc);

    // walls
    const tall = h > 13;
    color.setHex(WALLS[Math.floor(rand() * WALLS.length)]);
    if (tall) color.lerp(new THREE.Color(0xb8c4cf), 0.5);
    const shade = 0.9 + rand() * 0.2;
    color.multiplyScalar(shade);
    const wp = [], wn = [], wu = [], wc = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c.x - a.x, dz = c.y - a.y;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      const bays = Math.max(1, Math.round(len / 3.6));
      const u0 = 0, u1 = bays, v1 = Math.max(1, Math.round((top - bottom - 0.5) / 3.1));
      along += len;
      wp.push(a.x, bottom, a.y, c.x, top, c.y, c.x, bottom, c.y, a.x, bottom, a.y, a.x, top, a.y, c.x, top, c.y);
      for (let k = 0; k < 6; k++) wn.push(nx, 0, nz);
      wu.push(u0, 0, u1, v1, u1, 0, u0, 0, u0, v1, u1, v1);
      const dark = 0.72;
      const cols = [dark, 1, dark, dark, 1, 1];
      for (const m of cols) wc.push(color.r * m, color.g * m, color.b * m);
    }
    push(hot ? parts.hot : tall ? parts.tower : parts.wall, wp, wn, wu, wc);
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
  const winTex = windowTexture(), houseTex = houseTexture();
  disposables.push(winTex, houseTex);
  const mats = {
    roof: new THREE.MeshLambertMaterial({ map: groundTex }),
    wall: new THREE.MeshLambertMaterial({ vertexColors: true, map: houseTex }),
    tower: new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex }),
    hot: new THREE.MeshLambertMaterial({ vertexColors: true, map: houseTex, emissive: 0xffc46b, emissiveIntensity: 0.16 }),
  };
  for (const key of Object.keys(parts)) {
    if (!parts[key].length) continue;
    const mesh = new THREE.Mesh(merge(parts[key]), mats[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'buildings-' + key;
    group.add(mesh);
  }

  // ---- trees (two instanced meshes) and pools
  const dummy = new THREE.Object3D();
  const trees = scatter.trees || [];
  if (trees.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 5);
    trunkGeo.translate(0, 1.2, 0);
    const leafGeo = new THREE.IcosahedronGeometry(2.3, 0);
    leafGeo.translate(0, 4.1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a33 }), trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
    const greens = [0x3f7d3a, 0x4c8b3f, 0x356f3a, 0x5a9446, 0x2f6a44];
    trees.forEach((t, i) => {
      const q = proj.toLocal(t[1], t[0]);
      dummy.position.set(q.x, heightAt(q.x, q.z), q.z);
      dummy.rotation.set(0, i * 1.7, 0);
      dummy.scale.setScalar(t[2] || 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      leaves.setMatrixAt(i, dummy.matrix);
      leaves.setColorAt(i, color.setHex(greens[i % greens.length]));
    });
    leaves.castShadow = true;
    group.add(trunks, leaves);
  }
  const pools = scatter.pools || [];
  if (pools.length) {
    const poolGeo = new THREE.CircleGeometry(1, 14);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMesh = new THREE.InstancedMesh(poolGeo, new THREE.MeshLambertMaterial({ color: 0x37b6e6, emissive: 0x1d6f9c, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }), pools.length);
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

  // ---- sky, light, fog
  const sky = skyDome();
  group.add(sky);
  scene.fog = new THREE.Fog(0xcfe0ea, 320, 1500);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x7a7466, 1.15);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.75);
  const sunDir = new THREE.Vector3(0.55, 0.9, 0.35).normalize();
  sun.castShadow = !ctx.quality.low;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 700;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  group.add(hemi, sun, sun.target);

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

  const world = {
    city, area, proj, bounds, group, buildings, listings, commercial, nearby, base, mini, G, uvAt,
    heightAt, buildingAt, nearBuildings, pointIn, isFree, findSpawn,
    grid: { cols, rows, cell: CELL, blocked, cost, comp, mainComp },
    listingByBuilding,
    update(focus) {
      sky.position.set(focus.x, 0, focus.z);
      sun.position.set(focus.x + sunDir.x * 300, focus.y + sunDir.y * 300, focus.z + sunDir.z * 300);
      sun.target.position.copy(focus);
    },
    setShadows(on) { sun.castShadow = on; },
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
  }
  for (const c of commercial) {
    const q = proj.toLocal(c.lat, c.lon);
    c.x = q.x; c.z = q.z;
  }
  return world;
}
