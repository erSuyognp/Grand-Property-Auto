// Path A rails: our own camera inside the Matterport Showcase.
//
// Needs the Showcase SDK bundle served from our own origin (public/mp-bundle/, local only):
// the embedded Showcase has no Scene API, the bundle does. Our component "gpaWalkCamera"
// creates a camera in onInit and sets its position and quaternion in onTick; its `camera`
// output is bound to the `camera` input of Showcase's built in "mp.camera" control, and that
// control's `enabled` input switches who drives the view.
//
// What Showcase draws: while our camera is in charge it keeps projecting the last sweep's
// panorama onto the mesh, which smears as you leave that sweep. So the override is only on
// while riding. As the rider passes each scan position Showcase is told to make it the current
// sweep (the projection then comes from the nearest one), and once the rider settles the
// override is released and Sweep.moveTo puts Showcase exactly there: full sharpness again.
import * as THREE from 'three';
import { buildGraph, createRider, components } from './rails.js';

const TYPE = 'gpa.walkCamera';
const rad = Math.PI / 180;

export async function attachRail(ctx, sdk, win, hooks = {}) {
  if (!sdk.Scene || !sdk.Scene.register) throw new Error('this Showcase has no Scene API (the embed, not the bundle)');
  const pose0 = await sdk.Camera.pose.waitUntil((p) => !!p.sweep);
  const sweeps = await new Promise((resolve) => {
    const sub = sdk.Sweep.data.subscribe({ onCollectionUpdated(c) { const list = Object.values(c); if (list.length) { resolve(list); sub.cancel(); } } });
  });
  const usable = sweeps.filter((s) => s.enabled !== false && s.position && (!s.alignmentType || /aligned/i.test(String(s.alignmentType)) && !/unaligned/i.test(String(s.alignmentType))));
  const graph = buildGraph(usable.map((s) => ({ id: s.id, pos: s.position, neighbors: s.neighbors || [], floor: s.floorInfo && s.floorInfo.sequence, data: s })));
  // start where Showcase starts (the scan's own entry point), inside the largest joined piece
  const main = new Set(components(graph)[0] || []);
  let start = pose0.sweep;
  if (!main.has(start)) {
    let best = null, bd = Infinity;
    for (const id of main) { const d = graph.get(id).pos.distanceTo(new THREE.Vector3(pose0.position.x, pose0.position.y, pose0.position.z)); if (d < bd) { bd = d; best = id; } }
    start = best;
  }
  if (!start || main.size < 2) throw new Error('not enough joined scan positions for a route');
  const rider = createRider(graph, start);
  rider.faceHeading(pose0.rotation.y * rad, pose0.rotation.x * rad);

  const C = { riding: false, releasing: false, lastT: 0, lastSweep: start, look: null, disposed: false, tour: false, node: null, ctl: null, projection: null, keys: new Set() };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  function input() {
    const k = ctx.input.keys;
    const pad = C.pad || 0;
    return {
      move: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + pad,
      run: k.has('ShiftLeft') || k.has('ShiftRight'),
      branch: (k.has('KeyA') ? -1 : 0) + (k.has('KeyD') ? 1 : 0),
    };
  }

  async function engage() {
    if (C.riding || C.disposed) return;
    // carry on from exactly what Showcase shows: same place, same direction, same lens
    const p = await sdk.Camera.pose.waitUntil(() => true);
    // the visitor may have clicked to another sweep while Showcase had the camera
    if (p.sweep && p.sweep !== rider.state.node && main.has(p.sweep)) { rider.resetAt(p.sweep); C.lastSweep = p.sweep; }
    rider.faceHeading(p.rotation.y * rad, p.rotation.x * rad);
    C.projection = p.projection;
    C.riding = true; C.releasing = false;
    C.ctl.inputs.enabled = true;
    hooks.onMode && hooks.onMode('riding');
  }
  async function release() {
    if (!C.riding || C.releasing || C.disposed) return;
    C.releasing = true;
    const id = rider.state.node;
    const rot = { x: rider.state.pitch / rad, y: rider.heading / rad };
    C.ctl.inputs.enabled = false;
    C.riding = false;
    try { await sdk.Sweep.moveTo(id, { rotation: rot, transition: sdk.Sweep.Transition.INSTANT, transitionTime: 0 }); } catch { /* already there */ }
    C.lastSweep = id;
    C.releasing = false;
    hooks.onMode && hooks.onMode('settled');
    hooks.onSweep && hooks.onSweep(id);
  }

  await sdk.Scene.register(TYPE, () => ({
    outputs: { camera: null },
    onInit() {
      const T = this.context.three;
      this.cam = new T.PerspectiveCamera(70, win.innerWidth / win.innerHeight, 0.05, 1000);
      this.outputs.camera = this.cam;
    },
    onTick() {
      const now = performance.now();
      const dt = Math.min(0.05, C.lastT ? (now - C.lastT) / 1000 : 0.016);
      C.lastT = now;
      if (C.disposed) return;
      const inp = input();
      const wants = Math.abs(inp.move) > 0.01 || rider.state.auto;
      if (!C.riding) { if (wants && !C.releasing) engage(); return; }
      rider.update(dt, inp);
      const R = rider.state;
      this.cam.position.set(R.pos.x, R.pos.y, R.pos.z);
      euler.set(R.pitch, rider.heading, 0);
      this.cam.quaternion.set(0, 0, 0, 1);
      this.cam.rotation.order = 'YXZ';
      this.cam.rotation.set(euler.x, euler.y, 0);
      if (C.projection) { this.cam.projectionMatrix.fromArray(C.projection).transpose(); this.cam.projectionMatrixInverse.copy(this.cam.projectionMatrix).invert(); }
      this.cam.updateMatrixWorld(true);
      // keep Showcase's projected panorama on the scan position we are nearest to
      if (R.near && R.near !== C.lastSweep && !C.swapping) {
        C.swapping = true;
        const id = R.near;
        C.lastSweep = id;
        Promise.resolve(sdk.Sweep.moveTo(id, { transition: sdk.Sweep.Transition.INSTANT, transitionTime: 0 })).catch(() => {}).then(() => { C.swapping = false; hooks.onSweep && hooks.onSweep(id); });
      }
      if (R.done) {
        // the tour ends back where it began
        C.tour = false;
        rider.stopTour();
        rider.resetAt(C.home || R.rail.route[0]);
        release();
        hooks.onTourEnd && hooks.onTourEnd();
        return;
      }
      if (R.settled && !R.auto) release();
    },
    onDestroy() {},
  }));
  const [obj] = await sdk.Scene.createObjects(1);
  const node = obj.addNode();
  const comp = node.addComponent(TYPE);
  const ctl = node.addComponent('mp.camera', { enabled: false });
  obj.bindPath(obj.addInputPath(ctl, 'camera'), obj.addOutputPath(comp, 'camera'));
  node.start();
  C.node = node; C.ctl = ctl; C.obj = obj;

  // Keys typed while the Showcase frame has focus: ours first. Showcase's own W/A/S/D
  // (which jump between sweeps) are swallowed; everything else is passed on to the game.
  const OURS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight']);
  const down = (e) => {
    if (OURS.has(e.code)) { ctx.input.keys.add(e.code); e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (/^(Escape|KeyT|KeyP|KeyG|KeyN|Space|KeyV|KeyQ|Enter|Digit[1-4])$/.test(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); if (!e.repeat) ctx.emit('key', e.code, e); }
  };
  const up = (e) => { if (OURS.has(e.code)) { ctx.input.keys.delete(e.code); e.stopImmediatePropagation(); } if (/^(Space|KeyV)$/.test(e.code)) ctx.emit('keyup', e.code, e); };
  // mouse look on top of the path direction while riding (when settled, Showcase's own drag look runs)
  const pdown = (e) => { if (C.riding) { C.look = { x: e.clientX, y: e.clientY }; e.stopImmediatePropagation(); } };
  const pmove = (e) => {
    if (!C.riding || !C.look) return;
    rider.look((e.clientX - C.look.x) * 0.0042, (e.clientY - C.look.y) * 0.0042);
    C.look.x = e.clientX; C.look.y = e.clientY;
    e.stopImmediatePropagation();
  };
  const pup = () => { C.look = null; };
  win.addEventListener('keydown', down, true);
  win.addEventListener('keyup', up, true);
  win.addEventListener('pointerdown', pdown, true);
  win.addEventListener('pointermove', pmove, true);
  win.addEventListener('pointerup', pup, true);

  const api = {
    rider, graph,
    get riding() { return C.riding; },
    look(dx, dy) { if (C.riding) rider.look(dx, dy); else sdk.Camera.rotate((-dx * 180) / Math.PI, (dy * 180) / Math.PI, { speed: 120 }).catch(() => {}); },
    setPad(v) { C.pad = v; },
    async tour(seconds = 45) {
      if (C.tour) { rider.stopTour(); C.tour = false; return 0; }
      if (!C.riding) await engage();
      C.tour = true;
      C.home = rider.state.node || rider.state.near;
      return rider.startTour(seconds);
    },
    info() { return { ...rider.info(), riding: C.riding, tour: C.tour, sweeps: usable.length, joined: main.size, sweep: C.lastSweep }; },
    dispose() {
      C.disposed = true;
      try { ctl.inputs.enabled = false; node.stop(); } catch { /* frame already gone */ }
      for (const c of OURS) ctx.input.keys.delete(c);
      try {
        win.removeEventListener('keydown', down, true); win.removeEventListener('keyup', up, true);
        win.removeEventListener('pointerdown', pdown, true); win.removeEventListener('pointermove', pmove, true); win.removeEventListener('pointerup', pup, true);
      } catch { /* frame already gone */ }
    },
  };
  return api;
}
