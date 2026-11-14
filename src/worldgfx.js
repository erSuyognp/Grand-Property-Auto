// Look-and-feel helpers for the world: facade materials (color, gloss, lit windows at night),
// pitched roofs from footprints, tree and lamp geometry, and the close-up ground detail.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// deterministic random so every load of a city looks the same
export function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// ---------------------------------------------------------------- facades
// One texture covers 4 bays by 4 floors (128 px each), so lit windows and blinds do not repeat
// on every bay. Three canvases per style: color, gloss (G = roughness, B = metalness, so glass
// mirrors the sky) and emissive (windows lit at night).
const BAY = 128, N = 4;
export const STYLES = ['stucco', 'siding', 'brick', 'office', 'glass'];

function facadeCanvases(style, rand) {
  const size = BAY * N;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const col = mk(), orm = mk(), emi = mk();
  const g = col.getContext('2d'), o = orm.getContext('2d'), e = emi.getContext('2d');
  g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, size, size);
  o.fillStyle = 'rgb(0,232,0)'; o.fillRect(0, 0, size, size);
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);

  // wall surface
  if (style === 'stucco' || style === 'office') {
    for (let i = 0; i < 9000; i++) { const v = 226 + Math.floor(rand() * 24); g.fillStyle = `rgb(${v},${v},${v - 2})`; g.fillRect(rand() * size, rand() * size, 2 + rand() * 3, 2); }
  } else if (style === 'siding') {
    for (let y = 0; y < size; y += 8) {
      g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(0, y, size, 1.5);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y + 1.5, size, 1.5);
    }
  } else if (style === 'brick') {
    g.fillStyle = '#cfc8c0'; g.fillRect(0, 0, size, size);
    for (let y = 0, row = 0; y < size; y += 8, row++) {
      for (let x = (row % 2) * -8; x < size; x += 16) {
        const v = 200 + Math.floor(rand() * 50);
        g.fillStyle = `rgb(${v},${v - 6 - Math.floor(rand() * 10)},${v - 14})`;
        g.fillRect(x + 1, y + 1, 14, 6);
      }
    }
  }
  // streaks of weathering under the eaves and at the base
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, 'rgba(0,0,0,0.10)'); grad.addColorStop(0.08, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);

  const pane = (x, y, w, h, frame) => {
    // frame, glass with a soft sky gradient, a blind or curtain on some, lit on some
    if (frame) { g.fillStyle = frame; g.fillRect(x - 4, y - 4, w + 8, h + 8); }
    const t = 26 + Math.floor(rand() * 22);
    const gg = g.createLinearGradient(0, y, 0, y + h);
    gg.addColorStop(0, `rgb(${t + 22},${t + 34},${t + 48})`); gg.addColorStop(1, `rgb(${t},${t + 8},${t + 16})`);
    g.fillStyle = gg; g.fillRect(x, y, w, h);
    o.fillStyle = 'rgb(0,18,235)'; o.fillRect(x, y, w, h);
    const blind = rand();
    if (blind < 0.35) {
      const bh = h * (0.25 + rand() * 0.5);
      g.fillStyle = `rgba(${200 + rand() * 40},${196 + rand() * 40},${180 + rand() * 40},0.75)`; g.fillRect(x, y, w, bh);
      o.fillStyle = 'rgb(0,120,120)'; o.fillRect(x, y, w, bh);
    }
    if (rand() < (style === 'glass' || style === 'office' ? 0.42 : 0.5)) {
      const warm = rand();
      e.fillStyle = warm < 0.7 ? `rgb(255,${190 + Math.floor(rand() * 40)},${110 + Math.floor(rand() * 50)})` : 'rgb(190,215,255)';
      e.globalAlpha = 0.45 + rand() * 0.55;
      e.fillRect(x, y, w, h);
      e.globalAlpha = 1;
    }
  };

  for (let fy = 0; fy < N; fy++) {
    for (let fx = 0; fx < N; fx++) {
      const x0 = fx * BAY, y0 = fy * BAY;
      if (style === 'glass') {
        pane(x0 + 3, y0 + 4, BAY - 6, BAY - 30, null);
        g.fillStyle = '#39444c'; g.fillRect(x0 + 3, y0 + BAY - 26, BAY - 6, 22);  // spandrel
        o.fillStyle = 'rgb(0,60,200)'; o.fillRect(x0 + 3, y0 + BAY - 26, BAY - 6, 22);
        g.fillStyle = '#b9bec2'; g.fillRect(x0, y0, 3, BAY); g.fillRect(x0 + BAY - 3, y0, 3, BAY); g.fillRect(x0, y0, BAY, 4);
      } else if (style === 'office') {
        pane(x0 + 2, y0 + 30, 60, 62, null); pane(x0 + 66, y0 + 30, 60, 62, null);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y0 + 92, BAY, 3);
        g.fillStyle = '#8f9498'; g.fillRect(x0 + 62, y0 + 30, 4, 62);
      } else {
        const w = 50, h = 62, x = x0 + (BAY - w) / 2, y = y0 + 30;
        pane(x, y, w, h, '#fbfaf7');
        g.fillStyle = '#fbfaf7'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.48, w, 3);
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x - 6, y + h + 4, w + 12, 4); // sill shadow
        if (style === 'siding') { g.fillStyle = '#4a5a52'; g.fillRect(x - 16, y - 2, 10, h + 4); g.fillRect(x + w + 6, y - 2, 10, h + 4); }
      }
    }
  }
  return { col, orm, emi };
}

export function facadeMaterials(renderer) {
  const rand = rng(4711);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  const out = {}, textures = [];
  for (const style of STYLES) {
    const c = facadeCanvases(style, rand);
    const map = tex(c.col, true), orm = tex(c.orm, false), emi = tex(c.emi, true);
    textures.push(map, orm, emi);
    out[style] = new THREE.MeshStandardMaterial({
      vertexColors: true, map, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1,
      emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: 0,
    });
  }
  return { mats: out, textures };
}

// ---------------------------------------------------------------- roofs
function simplify(pts, tol) {
  // Douglas-Peucker on a closed ring (keeps the two farthest apart corners)
  if (pts.length <= 4) return pts.slice();
  let a = 0, b = 0, far = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = pts[i].distanceToSquared(pts[j]);
    if (d > far) { far = d; a = i; b = j; }
  }
  const dp = (list) => {
    if (list.length < 3) return list;
    const p0 = list[0], p1 = list[list.length - 1];
    const ex = p1.x - p0.x, ey = p1.y - p0.y, len = Math.hypot(ex, ey) || 1;
    let worst = 0, wi = -1;
    for (let i = 1; i < list.length - 1; i++) {
      const d = Math.abs((list[i].x - p0.x) * ey - (list[i].y - p0.y) * ex) / len;
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst <= tol) return [p0, p1];
    return dp(list.slice(0, wi + 1)).slice(0, -1).concat(dp(list.slice(wi)));
  };
  const first = dp(pts.slice(a, b + 1));
  const second = dp(pts.slice(b).concat(pts.slice(0, a + 1)));
  return first.slice(0, -1).concat(second.slice(0, -1));
}

// move every corner d meters inward (d < 0: outward); ring is counter clockwise
function offsetRing(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    let ax = c.x - p.x, ay = c.y - p.y, bx = q.x - c.x, by = q.y - c.y;
    const al = Math.hypot(ax, ay) || 1, bl = Math.hypot(bx, by) || 1;
    ax /= al; ay /= al; bx /= bl; by /= bl;
    const n1x = -ay, n1y = ax, n2x = -by, n2y = bx; // inward normals
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-4) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
    const k = d / Math.max(0.4, mx * n1x + my * n1y);
    out.push(new THREE.Vector2(c.x + mx * k, c.y + my * k));
  }
  return out;
}

function insetValid(outer, inner) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if ((inner[j].x - inner[i].x) * (outer[j].x - outer[i].x) + (inner[j].y - inner[i].y) * (outer[j].y - outer[i].y) <= 0) return false;
  }
  return THREE.ShapeUtils.area(inner) > 0;
}

// A hip style roof for any footprint: eaves that overhang a little, slopes that climb to a
// ridge as far in as the outline allows. Returns null when the outline is too irregular.
export function pitchedRoof(pts, top, h) {
  const simp = simplify(pts, 1.1);
  if (simp.length < 3 || THREE.ShapeUtils.area(simp) < 12) return null;
  const outer = offsetRing(simp, -0.4);
  let lo = 0, hi = 6.5;
  if (!insetValid(outer, offsetRing(outer, 0.7))) return null;
  lo = 0.7;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (insetValid(outer, offsetRing(outer, mid))) lo = mid; else hi = mid;
  }
  const d = lo * 0.985;
  const inner = offsetRing(outer, d);
  const rise = Math.min(d * 0.52, h * 0.42, 3.2);
  if (rise < 0.5) return null;
  const eave = top - rise;
  const pos = [], nor = [];
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-7) return;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) nor.push(nx, ny, nz);
  };
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [outer[i].x, eave, outer[i].y], b = [outer[j].x, eave, outer[j].y];
    const c = [inner[j].x, top, inner[j].y], e = [inner[i].x, top, inner[i].y];
    tri(a, b, c); tri(a, c, e);
  }
  for (const t of THREE.ShapeUtils.triangulateShape(inner, [])) {
    tri([inner[t[0]].x, top, inner[t[0]].y], [inner[t[1]].x, top, inner[t[1]].y], [inner[t[2]].x, top, inner[t[2]].y]);
  }
  return { pos, nor, eave };
}

// ---------------------------------------------------------------- trees and lamps
// A clump of leaves on a transparent card. The bottom left corner is solid so the trunk,
// which shares the material, can point its texture coordinates there.
export function foliageTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = rng(2024);
  for (let i = 0; i < 520; i++) {
    const a = rand() * Math.PI * 2, r = Math.pow(rand(), 0.6) * S * 0.46;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.92;
    const depth = rand();
    const l = 13 + depth * 22, hue = 74 + rand() * 40;
    g.fillStyle = `hsl(${hue}, ${30 + rand() * 20}%, ${l}%)`;
    g.save();
    g.translate(x, y); g.rotate(rand() * Math.PI);
    g.beginPath(); g.ellipse(0, 0, 5 + rand() * 6, 2.2 + rand() * 2.6, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.fillStyle = '#ffffff';
  g.fillRect(0, S - 6, 6, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function treeGeometry() {
  const rand = rng(99);
  const pos = [], nor = [], uv = [], col = [];
  // trunk and two limbs
  const limb = (x0, y0, z0, x1, y1, z1, r0, r1) => {
    const axis = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
    const len = axis.length();
    const cyl = new THREE.CylinderGeometry(r1, r0, len, 6, 1, true).toNonIndexed();
    cyl.translate(0, len / 2, 0);
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    cyl.translate(x0, y0, z0);
    const P = cyl.attributes.position, Nn = cyl.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      uv.push(0.012, 0.012); col.push(0.33, 0.25, 0.19);
    }
    cyl.dispose();
  };
  limb(0, 0, 0, 0.1, 3.3, 0, 0.3, 0.17);
  limb(0.1, 3.0, 0, 1.2, 4.6, 0.5, 0.15, 0.06);
  limb(0.1, 2.8, 0, -1.0, 4.5, -0.7, 0.15, 0.06);
  // leaf cards scattered through the crown, lit as if they were the surface of one ball
  const center = new THREE.Vector3(0, 4.7, 0);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  for (let k = 0; k < 15; k++) {
    const a = rand() * Math.PI * 2, y = (rand() - 0.42) * 1.9, r = Math.sqrt(Math.max(0, 1 - (y / 1.9) ** 2)) * (0.5 + rand() * 1.25);
    const c0 = new THREE.Vector3(Math.cos(a) * r, 4.7 + y, Math.sin(a) * r);
    const size = 1.5 + rand() * 0.9;
    q.setFromEuler(e.set((rand() - 0.5) * 1.8, rand() * Math.PI * 2, (rand() - 0.5) * 1.0));
    const shadeIn = 0.62 + 0.38 * THREE.MathUtils.clamp(c0.distanceTo(center) / 2.1, 0, 1);
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      v.set(cx * size, cy * size, 0).applyQuaternion(q).add(c0);
      pos.push(v.x, v.y, v.z);
      const n = v.clone().sub(center).normalize().add(new THREE.Vector3(0, 0.5, 0)).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(cx * 0.5 + 0.5, cy * 0.5 + 0.5);
      const sh = shadeIn * (0.72 + 0.28 * THREE.MathUtils.clamp((v.y - 3.2) / 3.2, 0, 1));
      col.push(sh, sh, sh);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function treeMaterials(map) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9, metalness: 0 });
  // both sides of a leaf card take the same light (the normals already describe the crown)
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
  return { mat, depth };
}

export function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 6.4, 6);
  pole.translate(0, 3.2, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.7);
  arm.translate(0, 6.35, -0.8);
  const g = mergeGeometries([pole, arm]);
  pole.dispose(); arm.dispose();
  const head = new THREE.BoxGeometry(0.34, 0.1, 0.62);
  head.translate(0, 6.27, -1.5);
  return { pole: g, head };
}

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.35, 'rgba(255,196,120,0.45)'); gr.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- ground detail
// The aerial photo is about a hand wide per pixel, which smears under the chase camera. Near
// the camera the shader reads what the photo shows (dark gray = asphalt, green = planting,
// the rest = concrete, dirt, roofs of sheds) and lays a crisp material over it: stone
// aggregate and hairline cracks on asphalt, blades on grass, fine grain elsewhere. The photo
// still decides where everything is and how bright it is.
export function groundMaterial(groundTex) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = rng(31337);
  const img = g.createImageData(S, S);
  const d = img.data;
  // R: fine grain, G: asphalt aggregate, B: grass blades (all centered on 128)
  for (let i = 0; i < S * S; i++) {
    d[i * 4] = 128 + (rand() - 0.5) * 110;
    const stone = rand();
    d[i * 4 + 1] = stone > 0.93 ? 205 + rand() * 50 : stone < 0.1 ? 60 + rand() * 30 : 112 + (rand() - 0.5) * 60;
    d[i * 4 + 2] = 128;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // cracks and tar seams in the green channel, blades in the blue channel
  g.globalCompositeOperation = 'darken';
  g.strokeStyle = 'rgb(255,40,255)';
  for (let k = 0; k < 9; k++) {
    g.lineWidth = 0.8 + rand() * 1.2;
    g.beginPath();
    let x = rand() * S, y = rand() * S;
    g.moveTo(x, y);
    for (let j = 0; j < 14; j++) { x += (rand() - 0.5) * 70; y += (rand() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  const blades = g.getImageData(0, 0, S, S);
  const bd = blades.data;
  for (let k = 0; k < 5200; k++) {
    let x = rand() * S, y = rand() * S;
    const v = 60 + rand() * 180, lean = (rand() - 0.5) * 0.9, len = 5 + rand() * 12;
    for (let j = 0; j < len; j++) {
      const px = ((Math.floor(x) % S) + S) % S, py = ((Math.floor(y) % S) + S) % S;
      bd[(py * S + px) * 4 + 2] = v;
      x += lean; y -= 1;
    }
  }
  g.putImageData(blades, 0, 0);
  const detail = new THREE.CanvasTexture(c);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vGroundXZ;\nfloat gRough = 0.0;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 gc = diffuseColor.rgb;
          // the photo's own shadows are deep and blue; the game adds real shadows on top, so
          // lift them and take the cast out before anything else
          float gL0 = dot(gc, vec3(0.2126, 0.7152, 0.0722));
          float gBlue = smoothstep(0.0, 0.22, (gc.b - max(gc.r, gc.g)) / (gL0 + 0.02));
          gc = mix(gc, vec3(gL0) * vec3(1.03, 1.0, 0.95), gBlue * 0.85);
          gc *= mix(1.9, 1.0, smoothstep(0.01, 0.16, gL0));
          diffuseColor.rgb = gc;
          float gDist = length(vViewPosition);
          float gNear = 1.0 - smoothstep(25.0, 140.0, gDist);
          float gMx = max(gc.r, max(gc.g, gc.b)), gMn = min(gc.r, min(gc.g, gc.b));
          float gLum = dot(gc, vec3(0.2126, 0.7152, 0.0722));
          float gGreen = smoothstep(0.004, 0.03, gc.g - max(gc.r, gc.b));
          float gGray = 1.0 - smoothstep(0.03, 0.11, gMx - gMn);
          float gAsphalt = (1.0 - gGreen) * gGray * (1.0 - smoothstep(0.2, 0.42, gLum));
          vec3 dFine = texture2D(detailMap, vGroundXZ * 0.21).rgb;
          vec3 dMid = texture2D(detailMap, vGroundXZ * 0.047 + 0.37).rgb;
          vec3 dWide = texture2D(detailMap, vGroundXZ * 0.009).rgb;
          // asphalt: pull the blue cast of baked shadows back to neutral, then aggregate
          vec3 road = vec3(gLum) * vec3(1.02, 1.0, 0.97) * (0.5 + dFine.g * 0.95) * (0.8 + dMid.g * 0.4) * (0.9 + dWide.r * 0.2);
          // planting: blades at two scales, a little deeper and greener than the photo
          vec3 lawn = gc * vec3(0.86, 1.04, 0.78) * (0.45 + dFine.b * 1.05) * (0.75 + dMid.b * 0.5);
          vec3 other = gc * (0.66 + dFine.r * 0.68) * (0.88 + dWide.r * 0.24);
          vec3 crisp = mix(other, lawn, gGreen);
          crisp = mix(crisp, road, gAsphalt);
          diffuseColor.rgb = mix(gc, crisp, gNear);
          gRough = gAsphalt * gNear * (dFine.g - 0.45) * 0.5;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - 0.12 * step(0.0001, abs(gRough)) - gRough, 0.3, 1.0);');
  };
  return { mat, detail };
}
