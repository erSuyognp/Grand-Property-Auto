// Car models from Kenney's Car Kit (CC0, public/models/kenney/License.txt): a low poly sedan
// for the player and a few others for traffic. Each model has a body and four wheel nodes, so
// the wheels spin and the front pair steers. The kit colors every car from one small palette
// image; to repaint a car, the palette is copied and the body's main color is replaced.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SCALE = 1.62;            // the kit's sedan is 2.55 long; ours should be about 4.1 m
const loader = new GLTFLoader();
const cache = new Map();

function load(name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((resolve, reject) => loader.load(`/models/kenney/${name}.glb`, (g) => resolve(g.scene), undefined, reject)));
  }
  return cache.get(name);
}

// the body's main paint color: the palette entry that covers the most surface, tires and
// glass (dark entries) aside
function repaint(root, color) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const bodyMesh = meshes.find((o) => /body/i.test(o.name) || /body/i.test(o.parent?.name || '')) || meshes[0];
  if (!bodyMesh || !bodyMesh.material.map || !bodyMesh.material.map.image) return null;
  const img = bodyMesh.material.map.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  const at = (u, v) => {
    const x = Math.min(c.width - 1, Math.max(0, Math.floor(u * c.width))), y = Math.min(c.height - 1, Math.max(0, Math.floor(v * c.height)));
    const i = (y * c.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const geo = bodyMesh.geometry, uv = geo.attributes.uv, pos = geo.attributes.position, idx = geo.index;
  const area = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), e = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    const col = at(uv.getX(i0), uv.getY(i0)); // glTF texture coordinates start at the top
    if (Math.max(...col) < 70) continue;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); e.fromBufferAttribute(pos, i2);
    const key = col.join(',');
    area.set(key, (area.get(key) || 0) + b.sub(a).cross(e.sub(a)).length());
  }
  if (!area.size) return null;
  const main = [...area.entries()].sort((x, y) => y[1] - x[1])[0][0].split(',').map(Number);
  // THREE.Color holds linear values; the canvas wants sRGB
  const srgb = new THREE.Color(color).convertLinearToSRGB();
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - main[0]) + Math.abs(d[i + 1] - main[1]) + Math.abs(d[i + 2] - main[2]) < 40) {
      d[i] = Math.round(srgb.r * 255); d[i + 1] = Math.round(srgb.g * 255); d[i + 2] = Math.round(srgb.b * 255);
    }
  }
  g.putImageData(px, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  return tex;
}

// Returns a group ready to drop into the car, with its wheels: [{ pivot, w, front, dir }].
export async function makeCarModel(name, color) {
  const src = await load(name);
  const root = src.clone(true);
  const tex = repaint(root, color);
  const mat = new THREE.MeshStandardMaterial({ map: tex || null, roughness: 0.42, metalness: 0.25, envMapIntensity: 2.2 });
  const wheels = [];
  root.traverse((o) => {
    if (o.isMesh) {
      if (!tex) mat.map = o.material.map;
      o.material = mat;
      o.castShadow = true; o.receiveShadow = true;
    }
    const m = /^wheel-(front|back)/.exec(o.name || '');
    if (m) {
      o.rotation.order = 'YXZ';
      wheels.push({ pivot: o, w: o, front: m[1] === 'front', dir: -1 });
    }
  });
  const holder = new THREE.Group();
  root.scale.setScalar(SCALE);
  root.rotation.y = Math.PI; // the kit's cars face +z, ours drive toward -z
  holder.add(root);
  return { holder, wheels, radius: 0.3 * SCALE };
}

export const TRAFFIC_MODELS = ['sedan', 'suv', 'hatchback-sports', 'sedan-sports'];

// ---------------------------------------------------------------- a car model of your own
// If public/models/local/car.glb exists (that folder is not in git), the player drives it
// instead of the Kenney sedan. The file is used exactly as it is: fitted to size, set on its
// wheels and pointed forward at run time, never repainted or re-exported, and its author and
// license (read from the file) are credited on the title screen. Not used in mock mode,
// which is what public pictures are made from.
export async function makeLocalCar() {
  const url = '/models/local/car.glb';
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok || (head.headers.get('content-type') || '').includes('html')) throw new Error('no local car model');
  const gltf = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  const root = gltf.scene;
  const holder = new THREE.Group(), fit = new THREE.Group();
  fit.add(root); holder.add(fit);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) { fit.rotation.y = Math.PI / 2; holder.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(root); size = box.getSize(new THREE.Vector3()); }
  const scale = 4.7 / size.z;
  const center = box.getCenter(new THREE.Vector3());
  fit.scale.setScalar(scale);
  fit.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  holder.updateMatrixWorld(true);

  // rims that are their own parts can spin; the smaller pair is the front
  const rims = [];
  root.traverse((o) => { if (/^(llanta|wheel|rim|felge|jante)[ _.-]?\d*$/i.test(o.name || '')) rims.push(o); });
  const info = rims.map((o) => { const b = new THREE.Box3().setFromObject(o); return { o, c: b.getCenter(new THREE.Vector3()), r: (b.max.y - b.min.y) / 2 }; });
  if (info.length >= 4) {
    const a = info.filter((w) => w.c.z < 0), b = info.filter((w) => w.c.z >= 0);
    const mean = (l) => l.reduce((s, w) => s + w.r, 0) / Math.max(1, l.length);
    if (a.length && b.length && mean(b) < mean(a) * 0.985) { fit.rotation.y += Math.PI; fit.position.x *= -1; fit.position.z *= -1; }
  }
  if (new URLSearchParams(location.search).has('carflip')) { fit.rotation.y += Math.PI; fit.position.x *= -1; fit.position.z *= -1; }
  holder.updateMatrixWorld(true);

  const wheels = [];
  for (const w of info) {
    const b = new THREE.Box3().setFromObject(w.o);
    const c = b.getCenter(new THREE.Vector3());
    const parent = w.o.parent, pivot = new THREE.Group();
    parent.add(pivot);
    pivot.position.copy(parent.worldToLocal(c.clone()));
    pivot.updateMatrixWorld(true);
    pivot.attach(w.o);
    // the centre cap that belongs to this rim turns with it
    const suffix = (w.o.name.match(/\d+$/) || [''])[0];
    const cap = parent.children.find((x) => x !== pivot && /^logo/i.test(x.name || '') && ((x.name.match(/\d+$/) || [''])[0] === suffix));
    if (cap) pivot.attach(cap);
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(new THREE.Matrix4().copy(parent.matrixWorld).invert()).normalize();
    const radius = ((b.max.y - b.min.y) / 2) * 1.38; // the tire around the rim
    wheels.push({ pivot, w: pivot, front: c.z < 0, noSteer: true, r: radius, spin: (angle) => pivot.rotateOnAxis(axis, angle) });
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 1.6; } });
  const ex = (gltf.asset && gltf.asset.extras) || {};
  const short = (s) => String(s || '').replace(/\s*\(https?:[^)]*\)/, '');
  const credit = ex.title ? `Car model: "${ex.title}" by ${short(ex.author) || 'unknown'}, ${short(ex.license) || 'license not stated'}` : 'Car model: local file, license not stated';
  return { holder, wheels, credit, local: true };
}
