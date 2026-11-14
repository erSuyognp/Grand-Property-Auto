// Ambient traffic: a handful of cars that drive routes between random stretches of road, slow
// for the player and for each other, and switch their lights on at night. They use the same
// route finder as the gold line, so they go where the aerial photo looks like asphalt.
import * as THREE from 'three';
import { buildCarMesh } from './car.js';
import { findPath } from './nav.js';

const COLORS = [0xd9dde0, 0x1d2126, 0x8e9499, 0x2f4f7a, 0x7a1f1f, 0xe9e4d6, 0x39453c, 0xb9862e];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function initTraffic(ctx) {
  const count = ctx.params.has('notraffic') ? 0 : ctx.quality.low ? 4 : 9;
  const cars = [];
  let roadCells = [], queue = [], clock = 0;

  function randomRoad(world) {
    const { cols, cell } = world.grid, b = world.bounds;
    const i = roadCells[Math.floor(Math.random() * roadCells.length)];
    return { x: b.minX + ((i % cols) + 0.5) * cell, z: b.minZ + (Math.floor(i / cols) + 0.5) * cell };
  }
  function newRoute(c) {
    const world = ctx.world;
    if (!world || !roadCells.length) return;
    for (let tries = 0; tries < 6; tries++) {
      const to = randomRoad(world);
      if (Math.hypot(to.x - c.x, to.z - c.z) < 140) continue;
      const r = findPath(world, { x: c.x, z: c.z }, to);
      if (r.length > 12) { c.route = r; c.i = 0; return; }
    }
    c.route = null;
  }

  ctx.on('city', (world) => {
    for (const c of cars) ctx.scene.remove(c.mesh);
    cars.length = 0; queue = [];
    const { cols, rows, blocked, cost, comp, mainComp } = world.grid;
    roadCells = [];
    for (let r = 3; r < rows - 3; r++) for (let cc = 3; cc < cols - 3; cc++) {
      const i = r * cols + cc;
      if (blocked[i] || cost[i] > 1 || comp[i] !== mainComp) continue;
      if (cost[i - 1] > 1 || cost[i + 1] > 1 || cost[i - cols] > 1 || cost[i + cols] > 1) continue; // middle of the road
      roadCells.push(i);
    }
    if (roadCells.length < 50) return;
    for (let k = 0; k < count; k++) {
      const built = buildCarMesh(COLORS[k % COLORS.length], true);
      const p = randomRoad(world);
      const c = { ...built, mesh: built.car, x: p.x, z: p.z, y: world.heightAt(p.x, p.z), heading: Math.random() * 6.28, speed: 0, route: null, i: 0, wait: 0 };
      c.mesh.position.set(c.x, c.y, c.z);
      ctx.scene.add(c.mesh);
      cars.push(c);
      queue.push(c);
    }
  });
  ctx.on('city-unload', () => { for (const c of cars) ctx.scene.remove(c.mesh); cars.length = 0; queue = []; });

  ctx.on('update', (dt) => {
    const world = ctx.world;
    if (!world || !cars.length) return;
    // route finding is the costly part: one car per quarter second
    clock += dt;
    if (queue.length && clock > 0.25) { clock = 0; newRoute(queue.shift()); }
    const me = ctx.car.state;
    const night = ctx.env ? ctx.env.state.night : 0;
    for (const c of cars) {
      if (!c.route) { if (!queue.includes(c)) queue.push(c); c.speed = 0; continue; }
      const r = c.route;
      while (c.i < r.length - 1 && Math.hypot(r[c.i].x - c.x, r[c.i].z - c.z) < 7) c.i++;
      if (c.i >= r.length - 1) { c.route = null; continue; }
      const t0 = r[c.i], t1 = r[Math.min(r.length - 1, c.i + 1)];
      // keep right: aim beside the route, as far as the street is wide
      let tx = t1.x, tz = t1.z;
      if (world.roads) {
        const lx = t1.x - t0.x, lz = t1.z - t0.z, ll = Math.hypot(lx, lz) || 1;
        const off = THREE.MathUtils.clamp(-world.roads.sdAt(t1.x, t1.z) - 1.4, 0, 1.9);
        tx += (-lz / ll) * off; tz += (lx / ll) * off;
      }
      const t = { x: tx, z: tz };
      const want = Math.atan2(-(t.x - c.x), -(t.z - c.z));
      const err = wrap(want - c.heading);
      c.heading += THREE.MathUtils.clamp(err, -1.6 * dt, 1.6 * dt) * Math.min(1, c.speed / 2 + 0.3);
      // slow for sharp turns, for the player and for other cars in front
      let target = Math.max(3, 10.5 - Math.abs(err) * 7);
      const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
      const ahead = (ox, oz, reach) => {
        const dx = ox - c.x, dz = oz - c.z, along = dx * fx + dz * fz;
        return along > 0 && along < reach && Math.abs(dx * fz - dz * fx) < 2.4;
      };
      if (ahead(me.x, me.z, 13)) target = 0;
      for (const o of cars) if (o !== c && ahead(o.x, o.z, 10)) target = Math.min(target, o.speed * 0.7);
      c.speed += THREE.MathUtils.clamp(target - c.speed, -14 * dt, 4 * dt);
      c.wait = c.speed < 0.3 ? c.wait + dt : 0;
      if (c.wait > 12) { c.route = null; c.wait = 0; continue; } // boxed in: go somewhere else
      c.x += fx * c.speed * dt; c.z += fz * c.speed * dt;
      c.y = world.heightAt(c.x, c.z);
      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.y = c.heading;
      for (const w of c.wheels) w.w.rotation.x -= (c.speed * dt) / 0.37;
      c.mats.tail.emissiveIntensity = target < c.speed - 0.5 ? 5 : 0.7 + night * 1.3;
      c.mats.light.emissiveIntensity = 1.2 + night * 5;
      // the player bounces off: push out along the line between the two cars
      const dx = me.x - c.x, dz = me.z - c.z, d = Math.hypot(dx, dz);
      if (d < 3.1 && d > 0.01 && ctx.state === 'play') {
        const nx = dx / d, nz = dz / d, push = 3.1 - d;
        me.x += nx * push; me.z += nz * push;
        const vn = me.vx * nx + me.vz * nz;
        if (vn < 0) { me.vx -= vn * nx * 1.3; me.vz -= vn * nz * 1.3; if (-vn > 4) ctx.emit('collision', -vn); }
        c.speed *= 0.5;
      }
    }
  });

  return { cars };
}
