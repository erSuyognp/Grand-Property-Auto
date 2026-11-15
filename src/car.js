// The car and its arcade physics: speed dependent steering, drift when turning hard at
// speed, terrain following, and sliding collisions against building footprints.
import * as THREE from 'three';
import { makeCarModel, makeLocalCar } from './carmodel.js';

const R = 1.35; // collision radius in meters

// An original coupe: a beveled body extruded from a side profile with wheel arches, a glass
// cabin, clear coat paint that reflects the sky, alloy wheels, and working lights.
function profile(points) {
  const sh = new THREE.Shape();
  points.forEach((q, i) => {
    if (q.arc) sh.absarc(q.arc[0], q.arc[1], q.arc[2], 0, Math.PI, false);
    else if (i === 0) sh.moveTo(q[0], q[1]);
    else sh.lineTo(q[0], q[1]);
  });
  sh.closePath();
  return sh;
}
function extrude(points, width, bevel) {
  const g = new THREE.ExtrudeGeometry(profile(points), {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelOffset: -bevel * 0.9, bevelSegments: 4, curveSegments: 12,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // profile +X (the nose) becomes -Z, the way the car drives
  g.computeVertexNormals();
  return g;
}

// The drawn car above is the stand in: as soon as the Kenney model (CC0) has loaded it takes
// over, with its own wheels, and a brake light strip and headlamp strip stay on top of it. If
// the model file is missing the stand in simply stays.
function swapInModel(built, model, color) {
  if (new URLSearchParams(location.search).has('boxcar')) return;
  const old = [...built.body.children], oldWheels = built.wheels.map((w) => w.pivot);
  const params = new URLSearchParams(location.search);
  // the player's car: a model of your own if one is in public/models/local/ (never in mock
  // mode), otherwise the Kenney sedan
  const own = !built.traffic && window.__gpa?.mode !== 'mock' && !params.has('kenney');
  const pick = own ? makeLocalCar().catch(() => makeCarModel(model, color)) : makeCarModel(model, color);
  pick.then((m) => {
    if (m.local) {
      for (const o of old) o.visible = false;
      for (const o of oldWheels) o.visible = false;
      built.body.add(m.holder);
      built.wheels.length = 0;
      for (const w of m.wheels) built.wheels.push(w);
      window.__gpa.carCredit = m.credit;
      const el = document.querySelector('#title .powered');
      if (el && !el.dataset.car) { el.dataset.car = '1'; el.append(document.createElement('br'), m.credit); }
      console.info('[car] ' + m.credit);
      return;
    }
    for (const o of old) o.visible = false;
    for (const o of oldWheels) o.visible = false;
    built.body.add(m.holder);
    built.wheels.length = 0;
    for (const w of m.wheels) built.wheels.push({ ...w, r: m.radius });
    const box = new THREE.Box3().setFromObject(m.holder);
    const tail = new THREE.Mesh(new THREE.BoxGeometry((box.max.x - box.min.x) * 0.72, 0.07, 0.04), built.mats.tail);
    tail.position.set(0, box.max.y * 0.52, box.max.z + 0.005);
    const head = new THREE.Mesh(new THREE.BoxGeometry((box.max.x - box.min.x) * 0.72, 0.06, 0.04), built.mats.light);
    head.position.set(0, box.max.y * 0.46, box.min.z - 0.005);
    built.body.add(tail, head);
  }).catch((e) => console.warn('[car] model not loaded, keeping the drawn car:', e.message || e));
}

// simple = a traffic car: same body, fewer small parts, no headlamp cone
export function buildCarMesh(color = 0xd63a1c, simple = false, model = 'sedan-sports') {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.75, metalness: 0.2 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.95 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.22, metalness: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1318, metalness: 0.9, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0 });
  const light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1cf, emissiveIntensity: 1.5 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x7a0c0c, emissive: 0xff1a0e, emissiveIntensity: 0.8 });
  const body = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); body.add(m); return m; };

  add(extrude([
    [-2.14, 0.3], [-2.2, 0.56], [-2.15, 0.93], [-1.5, 0.99], [0.75, 0.96], [1.9, 0.82], [2.17, 0.64], [2.2, 0.38], [2.06, 0.3],
    [1.82, 0.3], { arc: [1.36, 0.3, 0.46] }, [-0.93, 0.3], { arc: [-1.39, 0.3, 0.46] },
  ], 1.9, 0.15), paint);
  add(extrude([[-1.5, 0.95], [-0.98, 1.4], [0.12, 1.45], [0.9, 0.95]], 1.58, 0.1), glass);
  add(extrude([[-0.95, 1.43], [0.1, 1.475], [0.12, 1.5], [-0.93, 1.47]], 1.36, 0.03), paint);
  add(new THREE.BoxGeometry(1.6, 0.44, 0.09), dark, 0, 1.2, 0.34).rotation.x = -0.12;   // B pillar
  add(new THREE.BoxGeometry(1.72, 0.2, 3.7), dark, 0, 0.32, 0);                             // floor
  add(new THREE.BoxGeometry(1.2, 0.17, 0.06), dark, 0, 0.47, -2.19);                        // grille
  add(new THREE.BoxGeometry(1.8, 0.05, 0.3), dark, 0, 0.3, -2.1);                           // splitter
  add(new THREE.BoxGeometry(1.5, 0.1, 0.06), tail, 0, 0.83, 2.2);                           // light bar
  add(new THREE.BoxGeometry(1.62, 0.24, 0.06), dark, 0, 0.43, 2.2);                         // rear valance
  add(new THREE.BoxGeometry(0.5, 0.13, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.5 }), 0, 0.64, 2.22);
  add(new THREE.BoxGeometry(1.5, 0.05, 0.28), dark, 0, 1.02, 2.02);                         // lip spoiler
  for (const x of simple ? [] : [-1, 1]) {
    const h = add(new THREE.BoxGeometry(0.46, 0.1, 0.12), light, x * 0.64, 0.69, -2.12);
    h.rotation.x = 0.55;
    add(new THREE.BoxGeometry(0.1, 0.1, 0.2), paint, x * 0.99, 1.02, -0.62);                // mirror
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 8).rotateX(Math.PI / 2), alloy, x * 0.5, 0.33, 2.16); // exhaust
  }
  car.add(body);

  // soft contact shadow so the car sits on the road even where the sun shadow is faint
  const sc = document.createElement('canvas');
  sc.width = sc.height = 64;
  const sg = sc.getContext('2d');
  const gr = sg.createRadialGradient(32, 32, 6, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  blob.position.y = 0.06;
  car.add(blob);

  const tireGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.27, 22).rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.275, 16).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.29, 0.21, 0.055).translate(0, 0.14, 0);
  const wheels = [];
  for (const [x, z] of [[-0.83, -1.36], [0.83, -1.36], [-0.83, 1.39], [0.83, 1.39]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.37, z);
    const w = new THREE.Group();
    w.add(new THREE.Mesh(tireGeo, tire), new THREE.Mesh(discGeo, dark), new THREE.Mesh(hubGeo, alloy));
    for (let k = 0; k < (simple ? 0 : 5); k++) { const sp = new THREE.Mesh(spokeGeo, alloy); sp.rotation.x = (k / 5) * Math.PI * 2; w.add(sp); }
    pivot.add(w);
    car.add(pivot);
    wheels.push({ pivot, w, front: z < 0 });
  }
  car.traverse((o) => { if (o.isMesh && o !== blob) { o.castShadow = true; o.receiveShadow = true; } });

  if (simple) {
    add(new THREE.BoxGeometry(1.5, 0.1, 0.06), light, 0, 0.66, -2.19);
    swapInModel({ car, body, wheels, mats: { light, tail }, traffic: true }, model, color);
    return { car, body, wheels, mats: { light, tail } };
  }
  // headlamps: one cone that only carries light after dusk
  const beam = new THREE.SpotLight(0xfff0d2, 0, 70, 0.62, 0.7, 1.3);
  beam.position.set(0, 0.9, -1.9);
  beam.target.position.set(0, 0, -16);
  car.add(beam, beam.target);
  swapInModel({ car, body, wheels, mats: { light, tail } }, model, color);
  return { car, body, wheels, mats: { light, tail }, beam };
}

export function createCar(ctx) {
  const { car: mesh, body, wheels, mats, beam } = buildCarMesh();
  ctx.scene.add(mesh);
  const s = {
    x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, speed: 0, steer: 0, drifting: false, drift: 0,
    lastSafe: { x: 0, z: 0, heading: 0 }, frozen: false, impact: 0,
  };
  const fwd = new THREE.Vector2(), vel = new THREE.Vector2();
  let world = null;
  let safeTimer = 0;

  function place(x, z, heading = s.heading) {
    s.x = x; s.z = z; s.heading = heading; s.vx = s.vz = 0; s.speed = 0;
    s.y = world ? world.heightAt(x, z) : 0;
    s.lastSafe = { x, z, heading };
    sync(0);
  }

  function collide() {
    let hit = 0;
    for (const b of world.nearBuildings(s.x, s.z)) {
      if (s.x < b.minX - R || s.x > b.maxX + R || s.z < b.minZ - R || s.z > b.maxZ + R) continue;
      const inside = world.pointIn(b, s.x, s.z);
      let best = Infinity, bx = 0, bz = 0;
      const p = b.pts;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], c = p[(i + 1) % p.length];
        const ex = c.x - a.x, ez = c.y - a.y;
        const t = Math.max(0, Math.min(1, ((s.x - a.x) * ex + (s.z - a.y) * ez) / (ex * ex + ez * ez || 1)));
        const qx = a.x + ex * t, qz = a.y + ez * t;
        const d = Math.hypot(s.x - qx, s.z - qz);
        if (d < best) { best = d; bx = qx; bz = qz; }
      }
      if (!inside && best >= R) continue;
      let nx = s.x - bx, nz = s.z - bz;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len; nz /= len;
      if (inside) { nx = -nx; nz = -nz; }
      const push = inside ? best + R : R - best;
      s.x += nx * push; s.z += nz * push;
      const vn = s.vx * nx + s.vz * nz;
      if (vn < 0) {
        hit = Math.max(hit, -vn);
        s.vx -= vn * nx * 1.15; s.vz -= vn * nz * 1.15; // slide along the wall, tiny bounce
        s.vx *= 0.985; s.vz *= 0.985;
      }
    }
    return hit;
  }

  function sync(dt) {
    const h = world ? world.heightAt(s.x, s.z) : 0;
    s.y = dt ? THREE.MathUtils.lerp(s.y, h, Math.min(1, dt * 14)) : h;
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.set(0, s.heading, 0);
    if (world) {
      const sx = Math.sin(s.heading), cz = Math.cos(s.heading);
      const hf = world.heightAt(s.x - sx * 2, s.z - cz * 2), hb = world.heightAt(s.x + sx * 2, s.z + cz * 2);
      const hl = world.heightAt(s.x - cz, s.z + sx), hr = world.heightAt(s.x + cz, s.z - sx);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = Math.atan2(hf - hb, 4);
      mesh.rotation.z = Math.atan2(hr - hl, 2);
    }
  }

  function update(dt, input) {
    if (!world || s.frozen) { sync(dt); return; }
    const inp = input;
    fwd.set(-Math.sin(s.heading), -Math.cos(s.heading));
    vel.set(s.vx, s.vz);
    let vf = vel.dot(fwd);                      // forward speed
    let vl = vel.x * -fwd.y + vel.y * fwd.x;    // lateral speed (right positive)
    const maxSpeed = inp.boost ? 60 : 31;
    const accel = inp.boost ? 40 : 17;
    // how hard the boost is on, eased, for the camera and the speed blur
    s.boost = (s.boost || 0) + ((inp.boost && inp.throttle > 0 ? 1 : 0) - (s.boost || 0)) * Math.min(1, dt * 4);
    if (inp.throttle > 0) vf += accel * inp.throttle * dt * (vf < 0 ? 2.2 : 1 - Math.max(0, vf / maxSpeed) ** 2);
    else if (inp.throttle < 0) vf += (vf > 1 ? -34 : -11) * -inp.throttle * dt;
    vf = Math.max(-11, vf);
    vf -= vf * (inp.throttle === 0 ? 0.55 : 0.12) * dt; // rolling drag
    if (inp.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 16 * dt);

    // steering: quick at low speed, calmer at high speed
    s.steer += (inp.steer - s.steer) * Math.min(1, dt * 9);
    const speedAbs = Math.abs(vf);
    const turn = 2.6 * Math.min(1, speedAbs / 6) / (1 + speedAbs / 34);
    s.heading += s.steer * turn * dt * Math.sign(vf || 1);

    // grip: turning hard at speed (or the handbrake) lets the tail slide
    const hard = Math.abs(s.steer) > 0.8 && speedAbs > 17;
    s.drifting = (hard || (inp.handbrake && speedAbs > 7)) && Math.abs(vl) > 1.2;
    const grip = inp.handbrake ? 1.6 : hard ? 3.0 : 9.5;
    vl -= vl * Math.min(1, grip * dt);
    s.drift = THREE.MathUtils.lerp(s.drift, s.drifting ? Math.min(1, Math.abs(vl) / 7) : 0, Math.min(1, dt * 6));

    // rebuild velocity in the new heading frame (keeps the slide when heading changes)
    const nf = new THREE.Vector2(-Math.sin(s.heading), -Math.cos(s.heading));
    const carry = hard || inp.handbrake ? 0.9 : 0.25; // how much of the old direction survives a turn
    const dirX = fwd.x * carry + nf.x * (1 - carry), dirZ = fwd.y * carry + nf.y * (1 - carry);
    const dl = Math.hypot(dirX, dirZ) || 1;
    s.vx = (dirX / dl) * vf + -fwd.y * vl;
    s.vz = (dirZ / dl) * vf + fwd.x * vl;

    s.x += s.vx * dt; s.z += s.vz * dt;
    const hit = collide();
    if (hit > 3) { s.impact = hit; ctx.emit('collision', hit); }
    // invisible walls at the edge of the neighborhood
    const b = world.bounds, m = 6;
    if (s.x < b.minX + m) { s.x = b.minX + m; s.vx = Math.max(0, s.vx); }
    if (s.x > b.maxX - m) { s.x = b.maxX - m; s.vx = Math.min(0, s.vx); }
    if (s.z < b.minZ + m) { s.z = b.minZ + m; s.vz = Math.max(0, s.vz); }
    if (s.z > b.maxZ - m) { s.z = b.maxZ - m; s.vz = Math.min(0, s.vz); }
    s.speed = Math.hypot(s.vx, s.vz) * Math.sign(s.vx * nf.x + s.vz * nf.y || 1);

    safeTimer += dt;
    if (safeTimer > 1 && world.isFree(s.x, s.z)) { safeTimer = 0; s.lastSafe = { x: s.x, z: s.z, heading: s.heading }; }

    // visuals
    sync(dt);
    const night = ctx.env ? ctx.env.state.night : 0;
    const braking = (inp.throttle < 0 && vf > 0.5) || inp.handbrake;
    mats.tail.emissiveIntensity = braking ? 5 : 0.7 + night * 1.3;
    mats.light.emissiveIntensity = 1.4 + night * 5;
    beam.intensity = Math.max(0, night - 0.2) * 420;
    body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, -s.steer * Math.min(1, speedAbs / 20) * 0.09, Math.min(1, dt * 8));
    body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, -inp.throttle * 0.025, Math.min(1, dt * 6));
    for (const wh of wheels) {
      if (wh.spin) { wh.spin(-(vf * dt) / wh.r); continue; } // a model whose rims turn but cannot steer
      wh.w.rotation.x -= ((wh.dir || 1) * (vf * dt)) / (wh.r || 0.37);
      if (wh.front) wh.pivot.rotation.y = s.steer * 0.45;
    }
  }

  return {
    mesh, state: s, update, place, radius: R,
    setWorld(w) { world = w; },
    reset() {
      const p = world.isFree(s.lastSafe.x, s.lastSafe.z) ? s.lastSafe : { ...world.findSpawn(s.x, s.z), heading: s.heading };
      place(p.x, p.z, p.heading);
    },
    forward() { return { x: -Math.sin(s.heading), z: -Math.cos(s.heading) }; },
  };
}
