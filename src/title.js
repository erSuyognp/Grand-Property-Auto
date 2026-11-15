// Title screen: an aerial flyover behind an original logo, city choice and "Press Enter or
// scan to play". Then the camera drops from the sky to the car.
import { icon } from './icons.js';

const NAMES = { houston: 'Houston', la: 'Los Angeles', mock: 'Mockingbird Heights' };

export function initTitle(ctx) {
  const el = document.createElement('div');
  el.id = 'title';
  // film bars top and bottom; they open as the camera drops into the city
  el.innerHTML = `
    <i class="bar top"></i><i class="bar bot"></i>
    <div class="logo" aria-label="Grand Property Auto">
      <span class="l1">GRAND</span>
      <span class="l2">PROPERTY</span>
      <span class="l3"><i></i>AUTO<i></i></span>
    </div>
    <p class="tag">Drive the neighborhood. Say what you want. Walk inside.</p>
    <div class="cities"></div>
    <button class="go">Press <kbd>Enter</kbd> or scan to play</button>
    <div class="powered"><div class="srcs" aria-label="Powered by Vexcel, CoStar and Matterport"><span>${icon('plane', 15)}<b>Vexcel</b>aerial imagery</span><span>${icon('house', 15)}<b>CoStar</b>listings</span><span>${icon('footprints', 15)}<b>Matterport</b>3D tours</span></div></div>`;
  document.body.append(el);
  const cities = el.querySelector('.cities');
  for (const c of ctx.cities) {
    const b = document.createElement('button');
    b.dataset.city = c;
    b.textContent = NAMES[c] || c;
    b.addEventListener('click', () => { b.blur(); if (ctx.city !== c) ctx.loadCity(c); });
    cities.append(b);
  }
  if (ctx.cities.length < 2) cities.classList.add('single');
  const mark = () => { for (const b of cities.children) b.classList.toggle('on', b.dataset.city === ctx.city); };
  ctx.on('city', () => { mark(); if (ctx.state === 'title') ctx.cam.setMode('title'); });

  // The cover: the picture alone comes first. Enter, Space or a click moves on to the title
  // screen above. `?nocover` skips it (the screenshot script uses that).
  const cover = document.createElement('div');
  cover.id = 'cover';
  cover.innerHTML = '<img src="/cover.jpg" alt="Grand Property Auto cover art. Press Enter to continue">';
  document.body.append(cover);
  let covered = false;
  function uncover() {
    if (!covered) return;
    covered = false;
    cover.classList.add('out');
    setTimeout(() => cover.classList.remove('show', 'out'), 500);
    ctx.audio.click?.();
    // the title makes its entrance as the picture lifts, not unseen behind it
    if (el.classList.contains('show')) { el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
  }
  cover.addEventListener('click', uncover);

  function show() {
    ctx.state = 'title';
    ctx.cam.setMode('title');
    ctx.hud.setPlayVisible(false);
    el.classList.add('show');
    document.body.classList.add('titled');
    mark();
    if (!ctx.params.has('nocover')) { covered = true; cover.classList.remove('out'); cover.classList.add('show'); }
  }
  function start() {
    if (ctx.state !== 'title' || !ctx.world) return;
    // the title leaves over half a second (the logo comes forward, the bars open) while the
    // camera is already on its way down
    el.classList.add('out');
    setTimeout(() => el.classList.remove('show', 'out'), 620);
    document.body.classList.remove('titled');
    ctx.state = 'intro';
    ctx.audio.chime();
    ctx.cam.intro(() => {
      ctx.state = 'play';
      ctx.hud.setPlayVisible(true);
      ctx.emit('play-start');
    });
  }
  el.querySelector('.go').addEventListener('click', start);
  ctx.on('key', (code) => {
    if (ctx.state !== 'title') return;
    if (covered) { if (code === 'Enter' || code === 'Space' || code === 'KeyE') uncover(); return; } // the first Enter only lifts the cover
    if (code === 'Enter' || code === 'Space' || code === 'KeyE') start();
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const i = ctx.cities.indexOf(ctx.city);
      const next = ctx.cities[(i + (code === 'ArrowRight' ? 1 : ctx.cities.length - 1)) % ctx.cities.length];
      if (next !== ctx.city) ctx.loadCity(next);
    }
  });
  ctx.on('phone', (on) => { if (on && ctx.state === 'title') { uncover(); start(); } });

  // The name of the place and what is on the market there, set on screen as the car lands
  // and again after a city switch. The counts are the listings loaded for this city.
  const loc = document.createElement('div');
  loc.id = 'locard';
  const locLead = document.createElement('small'), locName = document.createElement('b'), locFacts = document.createElement('span');
  loc.append(locLead, locName, locFacts);
  ctx.hud.root.append(loc);
  let locTimer = 0, landed = false;
  function announce() {
    const w = ctx.world;
    if (!w) return;
    const n = {};
    for (const l of w.listings) n[l.kind] = (n[l.kind] || 0) + 1;
    locLead.textContent = 'Welcome to';
    locName.textContent = w.area?.name || NAMES[ctx.city] || '';
    locFacts.textContent = [[n.sale, 'for sale'], [n.rent, 'for rent'], [n.apartments, n.apartments === 1 ? 'apartment community' : 'apartment communities'], [n.sold, 'recently sold']]
      .filter(([count]) => count).map(([count, what]) => `${count} ${what}`).join(' · ');
    loc.classList.add('show');
    clearTimeout(locTimer);
    locTimer = setTimeout(() => loc.classList.remove('show'), 4800);
  }
  ctx.on('play-start', () => { landed = true; announce(); });
  ctx.on('city', () => { if (landed && ctx.state === 'play') announce(); });
  ctx.on('select', (l) => { if (l) loc.classList.remove('show'); });
  return { show, start, el, announce, get covered() { return covered; } };
}
