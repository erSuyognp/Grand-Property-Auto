// Price tags in the world: while you drive, the homes nearest the car carry their asking price
// or rent above the marker, so the street reads like a map of the market. The number is the
// listing's own (the same one its card shows). Recently sold homes get no tag: in Texas a sold
// price is only the last asking price, and a bare number on a tag cannot say that.
// With a search or a mission lit up, only the lit homes are tagged.
import * as THREE from 'three';
import { KIND_COLOR, money } from './format.js';

const MAX = 7;          // tags on screen at once
const NEAR = 190;       // meters from the car at which a home gets a tag
const FAR = 225;        // and at which it loses it again (so tags do not flicker at the edge)

function tagText(l) {
  if (l.kind === 'sold') return '';
  if (l.kind === 'apartments') {
    // a community's lowest rent: its own figure, or the lowest of its floor plans
    const plans = (l.floorPlans || []).map((f) => Number(f.rentMin)).filter((r) => r > 0);
    const rent = l.rent || (plans.length ? Math.min(...plans) : 0);
    return rent ? `from ${money(rent)}/mo` : '';
  }
  if (l.rent != null) return `${money(l.rent)}/mo`;
  return l.price != null ? money(l.price) : '';
}

export function initTags(ctx) {
  const box = document.createElement('div');
  box.id = 'tags';
  box.setAttribute('aria-hidden', 'true'); // the same price is on the card and in the panel
  ctx.hud.root.prepend(box);              // first in the HUD: every panel draws over the tags
  const slots = Array.from({ length: MAX }, () => {
    const el = document.createElement('div');
    el.className = 'ptag';
    const price = document.createElement('b'), facts = document.createElement('span');
    el.append(price, facts);
    box.append(el);
    return { el, price, facts, it: null, d: 0, x: 0, y: 0 };
  });
  const v = new THREE.Vector3();
  let acc = 1;

  const active = () => ctx.state === 'play' && ctx.world && !ctx.reveal?.open;

  function assign() {
    const L = ctx.listingsSys, s = ctx.car.state, hl = L.highlights, near = L.near;
    const want = [];
    for (const it of L.items) {
      const l = it.l;
      if (!L.visible[l.kind] || l === near || (hl && !hl.has(l.id))) continue;
      const d = Math.hypot(it.x - s.x, it.z - s.z);
      const held = slots.some((sl) => sl.it === it);
      // lit homes are what the player is looking for: they keep their tag from further away
      if (d > (held ? FAR : NEAR) * (hl ? 1.6 : 1) || !tagText(l)) continue;
      want.push({ it, d });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set(want.slice(0, MAX).map((w) => w.it));
    for (const sl of slots) if (sl.it && !keep.has(sl.it)) { sl.it = null; sl.el.classList.remove('on'); }
    for (const w of want.slice(0, MAX)) {
      let sl = slots.find((x) => x.it === w.it);
      if (!sl) {
        sl = slots.find((x) => !x.it);
        if (!sl) continue;
        const l = w.it.l;
        sl.it = w.it;
        sl.price.textContent = tagText(l);
        sl.facts.textContent = l.kind === 'apartments' || l.beds == null ? '' : Number(l.beds) === 0 ? 'studio' : `${l.beds} bd`;
        sl.facts.hidden = !sl.facts.textContent;
        sl.el.style.setProperty('--k', KIND_COLOR[l.kind] || '#fff');
      }
      sl.d = w.d;
      sl.el.classList.toggle('hl', !!hl);
    }
  }

  ctx.on('post', (dt) => {
    if (!active()) {
      if (acc !== 1) { acc = 1; for (const sl of slots) { sl.it = null; sl.el.classList.remove('on'); } }
      return;
    }
    acc += dt || 0.016;
    if (acc >= 0.15) { acc = 0; assign(); }
    const W = innerWidth, H = innerHeight, placed = [];
    // the corners and edges the HUD holds: a tag that would sit under one of them is not drawn
    const cardUp = ctx.hud.el.card.classList.contains('show');
    const blocked = (x, y) => (y < 104 && x < 560) || (y < 64 && x > W - 190) || (y < 132 && Math.abs(x - W / 2) < 420)
      || (y > H - 236 && x < 430) || (y > H - 118 && Math.abs(x - W / 2) < 190) || (y > H - 196 && x > W - 190)
      || (cardUp && x > W - 400);
    // nearest first: where two tags would cover each other the nearer one stays
    // A tag belongs just above its marker. Over a tall building (an apartment block, a condo
    // tower) the marker is often past the top of the screen, so the tag slides down the beam to
    // the highest point of it that is in view and clear of the HUD.
    const spot = { x: 0, y: 0 };
    const at = (it, h) => {
      v.set(it.x, h, it.z).project(ctx.camera);
      spot.x = ((v.x + 1) / 2) * W; spot.y = ((1 - v.y) / 2) * H;
      return v.z < 1 && spot.x > 40 && spot.x < W - 40 && spot.y > 34 && spot.y < H - 10 && !blocked(spot.x, spot.y);
    };
    for (const sl of [...slots].sort((a, b) => a.d - b.d)) {
      const it = sl.it;
      if (!it) continue;
      const hTop = it.top + 7.9 * it.size + 0.9, hLow = it.ground + 3;
      let show = at(it, hTop);
      if (!show && hTop > hLow) {
        let bad = hTop, good = null;
        for (let k = 1; k <= 8 && good === null; k++) { const h = hTop + (hLow - hTop) * (k / 8); if (at(it, h)) good = h; else bad = h; }
        if (good !== null) {
          for (let k = 0; k < 6; k++) { const mid = (good + bad) / 2; if (at(it, mid)) good = mid; else bad = mid; }
          show = at(it, good);
        }
      }
      const x = spot.x, y = spot.y;
      if (show && placed.some((p) => Math.abs(p.x - x) < 96 && Math.abs(p.y - y) < 26)) show = false;
      sl.el.classList.toggle('on', show);
      if (!show) continue;
      placed.push({ x, y });
      // smaller and fainter with distance, so the street has depth
      const k = Math.min(1, Math.max(0, (sl.d - 60) / (FAR - 60)));
      sl.el.style.setProperty('--o', (1 - 0.45 * k * k).toFixed(2));
      sl.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${(1 - 0.2 * k).toFixed(3)})`;
    }
  });
  ctx.on('city-unload', () => { for (const sl of slots) { sl.it = null; sl.el.classList.remove('on'); } });

  window.__gpa.tags = () => slots.filter((sl) => sl.it && sl.el.classList.contains('on')).map((sl) => ({ id: sl.it.l.id, text: sl.price.textContent }));
  return { el: box };
}
