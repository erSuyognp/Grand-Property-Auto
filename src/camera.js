// Chase camera with a little lag that pulls back as speed rises. C toggles a top down view,
// mouse drag orbits briefly and springs back. Also runs the scripted shots: title flyover,
// the spawn drop from the sky, and the swoop to a front door before a tour.
import * as THREE from 'three';

export function createCamera(ctx) {
  const cam = ctx.camera;
  const pos = new THREE.Vector3(0, 60, 60), look = new THREE.Vector3();
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3(), tmpFrom = new THREE.Vector3();
  let mode = 'chase';
  // C cycles three views: aerial (high and tilted, the default: the photo city looks its best
  // from here and still has depth), straight down, and the close street view
  const VIEWS = ['aerial', 'top', 'street'];
  let view = 0, topDown = false;
  try { const v = VIEWS.indexOf(ctx.params.get('view') || localStorage.getItem('gpa-view')); if (v >= 0) { view = v; topDown = v === 1; } } catch { /* private mode */ }
  let orbit = 0, orbitPitch = 0, dragging = false, lastX = 0, lastY = 0, releaseT = 0;
  let script = null; // {t, dur, fn(k), done}
  let t = 0, shakeT = 0, shakeAmp = 0;

  const el = ctx.renderer.domElement;
  el.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  addEventListener('pointerup', () => { dragging = false; releaseT = 0; });
  addEventListener('pointermove', (e) => {
    if (!dragging || mode !== 'chase') return;
    orbit -= (e.clientX - lastX) * 0.006;
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + (e.clientY - lastY) * 0.004, -0.25, 0.9);
    lastX = e.clientX; lastY = e.clientY;
  });

  const ease = (k) => k * k * (3 - 2 * k);

  function chaseTarget(car, out, outLook) {
    const s = car.state;
    const speed = Math.abs(s.speed);
    // about 10 m up and 14 m back, pitched down about 20 degrees; it sinks to about 6 m when
    // the car is nearly stopped (arriving at a house feels closer) and rises a little at speed
    const moving = THREE.MathUtils.smoothstep(speed, 0.5, 9);
    const aerial = view === 0;
    const dist = aerial ? 34 + moving * 10 + speed * 0.25 : 10.5 + moving * 3.5 + speed * 0.1;
    const height = (aerial ? 44 + moving * 14 + speed * 0.3 : 6 + moving * 4 + speed * 0.07) + orbitPitch * 9;
    const a = s.heading + orbit;
    out.set(s.x + Math.sin(a) * dist, s.y + height, s.z + Math.cos(a) * dist);
    // street view: the point on the ground that puts the view 20 degrees below the horizon;
    // aerial: look a little ahead of the car, about 50 degrees down
    const ahead = aerial ? 7 + speed * 0.35 : height / Math.tan(THREE.MathUtils.degToRad(20)) - dist;
    outLook.set(s.x - Math.sin(s.heading) * ahead, s.y + 0.6, s.z - Math.cos(s.heading) * ahead);
    if (topDown) {
      out.set(s.x + Math.sin(s.heading) * 0.01, s.y + 95 + speed, s.z + Math.cos(s.heading) * 0.01);
      outLook.set(s.x, s.y, s.z);
    }
    const world = ctx.world;
    if (world) {
      out.y = Math.max(out.y, world.heightAt(out.x, out.z) + 1.5);
      // never sit inside a building: lift the camera over the roof it would be in
      if (ctx.tiles && ctx.tiles.on) {
        if (!topDown) ctx.tiles.clearView(tmpFrom.set(s.x, s.y + 1.5, s.z), out);
      } else {
        const b = !topDown && world.buildingAt(out.x, out.z);
        if (b && out.y < b.top + 2) out.y = Math.min(b.top + 2.5, s.y + 60);
      }
    }
  }

  function update(dt) {
    t += dt;
    const car = ctx.car;
    if (script) {
      script.t += dt;
      const k = Math.min(1, script.t / script.dur);
      script.fn(ease(k), k);
      if (k >= 1) { const d = script.done; script = null; d && d(); }
    } else if (mode === 'title') {
      const w = ctx.world;
      const a = t * 0.05;
      const r = 330;
      pos.set(Math.cos(a) * r, 150 + Math.sin(t * 0.13) * 18, Math.sin(a) * r);
      look.set(Math.cos(a + 1.2) * 60, w ? w.heightAt(0, 0) : 0, Math.sin(a + 1.2) * 60);
    } else if (mode === 'chase' && car) {
      if (!dragging) {
        releaseT += dt;
        if (releaseT > 0.6) { orbit *= Math.max(0, 1 - dt * 4); orbitPitch *= Math.max(0, 1 - dt * 4); }
      }
      chaseTarget(car, wantPos, wantLook);
      pos.lerp(wantPos, Math.min(1, dt * (topDown ? 5 : 4.2)));
      look.lerp(wantLook, Math.min(1, dt * 9));
    }
    // 'free' mode: another system (the property reveal) moves pos and look itself
    cam.position.copy(pos);
    if (shakeT > 0) { // a small shake on mission success
      shakeT -= dt;
      const a = Math.max(0, shakeT) * shakeAmp;
      cam.position.x += (Math.random() - 0.5) * a; cam.position.y += (Math.random() - 0.5) * a; cam.position.z += (Math.random() - 0.5) * a;
    }
    if (topDown && mode === 'chase' && !script && car) cam.up.set(-Math.sin(car.state.heading), 0, -Math.cos(car.state.heading));
    else cam.up.set(0, 1, 0);
    cam.lookAt(look);
    const targetFov = mode === 'chase' && car ? (view === 0 ? 46 : 60) + Math.min(16, Math.max(0, Math.abs(car.state.speed) - 22) * 0.4) + (car.state.boost || 0) * 3 : 58;
    if (Math.abs(cam.fov - targetFov) > 0.05) { cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
  }

  return {
    update, pos, look,
    get mode() { return mode; },
    setMode(m) { mode = m; script = null; },
    toggleTop() {
      view = (view + 1) % VIEWS.length; topDown = view === 1;
      try { localStorage.setItem('gpa-view', VIEWS[view]); } catch { /* private mode */ }
      return VIEWS[view];
    },
    get view() { return VIEWS[view]; },
    snap() { if (ctx.car) { chaseTarget(ctx.car, pos, look); } },
    // drop from the sky to the car
    intro(done) {
      mode = 'chase';
      const from = new THREE.Vector3(ctx.car.state.x + 40, 420, ctx.car.state.z + 120), fromLook = new THREE.Vector3(ctx.car.state.x, 0, ctx.car.state.z);
      pos.copy(from); look.copy(fromLook);
      script = { t: 0, dur: 3.2, done, fn: (k) => { chaseTarget(ctx.car, wantPos, wantLook); pos.lerpVectors(from, wantPos, k); look.lerpVectors(fromLook, wantLook, k); } };
    },
    // swoop toward a point (the front door) before a tour
    swoop(target, done, dur = 1.25) {
      const from = pos.clone(), fromLook = look.clone();
      const to = new THREE.Vector3(target.x, target.y + 1.7, target.z);
      const dir = to.clone().sub(from).setY(0).normalize();
      const end = to.clone().addScaledVector(dir, -3);
      script = { t: 0, dur, done, fn: (k) => { pos.lerpVectors(from, end, k); look.lerpVectors(fromLook, to, Math.min(1, k * 1.6)); } };
    },
    isScripted() { return !!script; },
    shake(dur = 0.5, amp = 1.6) { if (!(ctx.settings?.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches)) { shakeT = dur; shakeAmp = amp; } },
  };
}
