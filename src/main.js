// Grand Property Auto entry point.
// Phase 0: placeholder scene (flat ground + box car) so the build and shot pipeline work.
import * as THREE from 'three';

const app = document.getElementById('app');
const fpsEl = document.getElementById('fps');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc9ee);
scene.fog = new THREE.Fog(0x9cc9ee, 200, 900);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 3000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(100, 200, 50);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1500, 1500, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0x6d8f5a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(1500, 60, 0x445533, 0x557744);
grid.position.y = 0.02;
scene.add(grid);

const car = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 4.2), new THREE.MeshLambertMaterial({ color: 0xe8442e }));
car.position.y = 0.6;
scene.add(car);

const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));

let speed = 0;
function updateCar(dt) {
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  speed += fwd * 25 * dt;
  speed *= 1 - 1.5 * dt;
  car.rotation.y += steer * dt * 2 * Math.sign(speed || 1) * Math.min(1, Math.abs(speed) / 5);
  car.position.x -= Math.sin(car.rotation.y) * speed * dt;
  car.position.z -= Math.cos(car.rotation.y) * speed * dt;
}

const camOffset = new THREE.Vector3();
function updateCamera() {
  camOffset.set(Math.sin(car.rotation.y) * 12, 6, Math.cos(car.rotation.y) * 12);
  camera.position.copy(car.position).add(camOffset);
  camera.lookAt(car.position.x, car.position.y + 1, car.position.z);
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Test hook read by Playwright.
const debug = (window.__gpa = { ready: false, fps: 0, car: { x: 0, z: 0 } });

const timer = new THREE.Timer();
let frames = 0, fpsTime = 0;
renderer.setAnimationLoop((t) => {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 0.05);
  updateCar(dt);
  updateCamera();
  renderer.render(scene, camera);
  debug.car.x = car.position.x;
  debug.car.z = car.position.z;
  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    debug.fps = Math.round(frames / fpsTime);
    fpsEl.textContent = `${debug.fps} fps`;
    frames = 0; fpsTime = 0;
  }
  debug.ready = true;
});
