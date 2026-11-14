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
