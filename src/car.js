// A low poly car with arcade physics: speed dependent steering, drift when turning hard at
// speed, terrain following, and sliding collisions against building footprints.
import * as THREE from 'three';

const R = 1.35; // collision radius in meters

function buildMesh() {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: 0xf2552c });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d2228 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd3ea, emissive: 0x24424f, emissiveIntensity: 0.4 });
  const light = new THREE.MeshLambertMaterial({ color: 0xfff6cf, emissive: 0xffe9a6, emissiveIntensity: 0.9 });
  const tail = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xa01010, emissiveIntensity: 0.7 });
  const body = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.3), paint);
  lower.position.y = 0.62;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 1.3), paint);
  hood.position.set(0, 0.95, -1.35);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.56, 2.0), glass);
  cabin.position.set(0, 1.17, 0.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.1, 1.7), paint);
  roof.position.set(0, 1.48, 0.3);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 4.32), new THREE.MeshLambertMaterial({ color: 0xfff3df }));
  stripe.position.set(0, 0.905, 0);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), dark);
  spoiler.position.set(0, 1.12, 2.05);
  body.add(lower, hood, cabin, roof, stripe, spoiler);
  for (const x of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), light);
    h.position.set(x, 0.7, -2.16);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.08), tail);
    t.position.set(x, 0.72, 2.16);
    body.add(h, t);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.22, 4.42), dark);
  bumper.position.y = 0.36;
  body.add(bumper);
  car.add(body);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[-0.95, -1.35], [0.95, -1.35], [-0.95, 1.4], [0.95, 1.4]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const w = new THREE.Mesh(wheelGeo, dark);
    pivot.add(w);
    car.add(pivot);
    wheels.push({ pivot, w, front: z < 0 });
  }
  car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { car, body, wheels };
}

export function createCar(ctx) {
  const { car: mesh, body, wheels } = buildMesh();
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
    const maxSpeed = inp.boost ? 46 : 31;
    const accel = inp.boost ? 26 : 17;
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
    body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, -s.steer * Math.min(1, speedAbs / 20) * 0.09, Math.min(1, dt * 8));
    body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, -inp.throttle * 0.025, Math.min(1, dt * 6));
    for (const wh of wheels) {
      wh.w.rotation.x -= (vf * dt) / 0.36;
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
