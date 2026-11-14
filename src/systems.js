// Starts every gameplay system in order. Each one registers on the event bus in ctx.
import { initHud } from './hud.js';
import { initListings } from './listings.js';
import { initMinimap } from './minimap.js';
import { initSaved } from './saved.js';
import { initTour } from './tour.js';
import { initMissions } from './missions.js';
import { initVoice } from './voice.js';
import { initController } from './controller.js';
import { initTitle } from './title.js';
import { initCompare } from './compare.js';
import { initDemo } from './demo.js';
import { findPath } from './nav.js';
import { initTraffic } from './traffic.js';
import { initTiles } from './tiles.js';
import { initDrone } from './drone.js';

export async function initSystems(ctx) {
  ctx.saved = initSaved(ctx);
  ctx.listingsSys = initListings(ctx);
  ctx.hud = initHud(ctx);
  ctx.minimap = initMinimap(ctx);
  ctx.tour = initTour(ctx);
  ctx.missions = initMissions(ctx);
  ctx.voice = initVoice(ctx);
  ctx.controller = initController(ctx);
  ctx.compare = initCompare(ctx);
  ctx.demoSys = initDemo(ctx);
  ctx.title = initTitle(ctx);
  ctx.traffic = initTraffic(ctx);
  ctx.tiles = initTiles(ctx);
  ctx.drone = initDrone(ctx);

  // "Take me there" from the saved homes screen: a mission with one target
  ctx.missions.goTo = (l) => {
    const M = ctx.missions.state;
    M.top = [l]; M.target = l; M.active = true; M.arrived = false;
    ctx.listingsSys.setHighlights([l.id], l);
    ctx.missions.reroute(true);
    ctx.missions.speak(`Heading to ${l.name || l.address}.`);
  };

  ctx.on('key', (code) => {
    if (ctx.state !== 'play' || ctx.hud.choosing) return;
    if (code === 'KeyC') ctx.cam.toggleTop();
    if (code === 'KeyR') ctx.car.reset();
    if (code === 'KeyM') ctx.hud.toast(ctx.audio.toggleMute() ? 'Sound off' : 'Sound on');
    if (code === 'KeyL') ctx.hud.toast({ day: 'Midday', golden: 'Golden hour', night: 'Night' }[ctx.env.cycle()]);
    const digit = /^Digit([1-4])$/.exec(code);
    if (digit) ctx.listingsSys.toggle(ctx.listingsSys.KINDS[Number(digit[1]) - 1]);
    if (code === 'KeyF' && ctx.listingsSys.near) {
      const l = ctx.listingsSys.near;
      const on = ctx.saved.toggle(l);
      ctx.hud.toast(on ? 'Saved to your list' : 'Removed from your list');
      ctx.audio.blip(on ? 880 : 440, 0.12);
    }
  });
  ctx.on('collision', (v) => { if (v > 6) ctx.audio.thud(); });

  // face the car down the nearest stretch of road when a city loads
  ctx.on('city', (world) => {
    const s = ctx.car.state;
    let best = 0, bestLen = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let len = 0;
      while (len < 120 && world.isFree(s.x - Math.sin(a) * len, s.z - Math.cos(a) * len)
        && world.grid.cost[Math.floor((s.z - Math.cos(a) * len - world.bounds.minZ) / world.grid.cell) * world.grid.cols + Math.floor((s.x - Math.sin(a) * len - world.bounds.minX) / world.grid.cell)] <= 1) len += 4;
      if (len > bestLen) { bestLen = len; best = a; }
    }
    ctx.car.place(s.x, s.z, best);
    ctx.cam.snap();
  });

  // test and debugging hooks
  const g = window.__gpa;
  g.say = (text) => ctx.missions.handle(text);
  g.mission = () => ctx.missions.info();
  g.findPath = (a, b) => findPath(ctx.world, a, b);
  g.teleportNear = (id, dist = 14) => {
    const l = ctx.world.listings.find((x) => x.id === id) || ctx.world.listings[0];
    const b = l.building;
    // closest free, road-like cell to the listing's building
    let best = null, bd = Infinity;
    for (let a = 0; a < Math.PI * 2; a += 0.2) for (let r = 4; r < 60; r += 2) {
      const x = (b ? b.cx : l.x) + Math.cos(a) * r, z = (b ? b.cz : l.z) + Math.sin(a) * r;
      if (!world().isFree(x, z)) continue;
      const d = Math.abs(r - dist);
      if (d < bd) { bd = d; best = { x, z }; }
    }
    if (best) ctx.car.place(best.x, best.z);
    return l.id;
  };
  const world = () => ctx.world;

  ctx.on('boot', () => {
    if (ctx.params.has('autostart') || ctx.params.has('demo')) {
      ctx.state = 'play';
      ctx.hud.setPlayVisible(true);
      if (ctx.params.has('demo')) setTimeout(() => ctx.demoSys.run(), 800);
    } else ctx.title.show();
  });
}
