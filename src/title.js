// Title screen: an aerial flyover behind an original logo, city choice and "Press Enter or
// scan to play". Then the camera drops from the sky to the car.
const NAMES = { houston: 'Houston', la: 'Los Angeles', mock: 'Mockingbird Heights' };

export function initTitle(ctx) {
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `
    <div class="logo" aria-label="Grand Property Auto">
      <span class="l1">GRAND</span>
      <span class="l2">PROPERTY</span>
      <span class="l3"><i></i>AUTO<i></i></span>
    </div>
    <p class="tag">Drive the neighborhood. Say what you want. Walk inside.</p>
    <div class="cities"></div>
    <button class="go">Press <kbd>Enter</kbd> or scan to play</button>
    <p class="powered">Powered by CoStar, Matterport, Vexcel</p>`;
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
    el.classList.remove('show');
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
  return { show, start, el, get covered() { return covered; } };
}
