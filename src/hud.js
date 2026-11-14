// Heads up display: listing and commercial cards, prompts, legend, speedometer, saved
// counter, captions, the mission arrow, choosers and the photo lightbox. No chat window:
// spoken lines only ever appear as one line captions.
import { KIND_COLOR, KIND_LABEL, aerialBadges, factsText, money, priceText } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const NAMES = { houston: 'Houston', la: 'Los Angeles', mock: 'Mockingbird Heights' };
const BADGE_ICON = {
  pool: '<path d="M2 15c2 0 2-1.5 4-1.5S8 15 10 15s2-1.5 4-1.5S16 15 18 15M6 11V5a2 2 0 0 1 4 0M12 11V5a2 2 0 0 1 4 0M6 8h6"/>',
  solar: '<circle cx="10" cy="10" r="3.5"/><path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8"/>',
  tree: '<path d="M10 2 4.5 10h3L4 15h12l-3.5-5h3zM10 15v3"/>',
  pin: '<path d="M10 18s6-5.6 6-10a6 6 0 0 0-12 0c0 4.400 6 10 6 10z"/><circle cx="10" cy="8" r="2"/>',
  roof: '<path d="M2 11 10 4l8 7M5 9.500V16h10V9.500"/>',
};
const icon = (name) => `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round">${BADGE_ICON[name] || BADGE_ICON.pin}</svg>`;

export function initHud(ctx) {
  const root = document.getElementById('hud');
  root.innerHTML = '';
  const el = {
    fps: $('<div id="fps" class="chip">-- fps</div>'),
    cityBar: $('<div id="citybar"></div>'),
    speedo: $('<div id="speedo"><b>0</b><span>mph</span></div>'),
    loading: $('<div id="loading"><div class="spinner"></div><span>Loading the neighborhood</span></div>'),
    card: $('<aside id="card" class="panel"></aside>'),
    ccard: $('<aside id="ccard" class="panel"></aside>'),
    legend: $('<div id="legend"></div>'),
    saved: $('<div id="saved" class="chip clickable"><svg viewBox="0 0 20 20" width="14" height="14"><path d="M10 17s-6.500-4.200-6.500-8.600A3.600 3.600 0 0 1 10 6.200a3.600 3.600 0 0 1 6.500 2.200C16.500 12.800 10 17 10 17z" fill="currentColor"/></svg><b>0</b> saved <kbd>Tab</kbd></div>'),
    caption: $('<div id="caption"></div>'),
    live: $('<div id="live"><span class="mic"></span><span class="txt"></span></div>'),
    arrow: $('<div id="arrow"><div class="needle"><svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 4 33 34 20 27 7 34z" fill="#ffc940" stroke="#14181f" stroke-width="2" stroke-linejoin="round"/></svg></div><div class="lbl"><b></b><span></span></div></div>'),
    toast: $('<div id="toast"></div>'),
    chooser: $('<div id="chooser" class="panel"></div>'),
    lightbox: $('<div id="lightbox" class="clickable"><img alt=""/></div>'),
    help: $('<div id="help" class="chip">WASD drive · Space handbrake · Shift boost · V talk · C view · L time of day · G 3D city · R reset · 0 demo</div>'),
    fade: $('<div id="fade"></div>'),
    typebox: $('<form id="typebox"><input type="text" maxlength="140" placeholder="Say what you are looking for" autocomplete="off"/></form>'),
  };
  root.append(el.fps, el.cityBar, el.speedo, el.card, el.ccard, el.legend, el.saved, el.caption, el.live, el.arrow, el.toast,
    el.chooser, el.help, el.typebox, el.lightbox, el.fade, el.loading);

  // ---- city switcher
  for (const c of ctx.cities) {
    const b = $(`<button data-city="${c}">${NAMES[c] || c}</button>`);
    b.addEventListener('click', () => { b.blur(); if (ctx.city !== c) ctx.loadCity(c); });
    el.cityBar.append(b);
  }
  if (ctx.cities.length < 2) el.cityBar.classList.add('single');
  ctx.on('city', () => {
    for (const b of el.cityBar.children) b.classList.toggle('on', b.dataset.city === ctx.city);
    renderLegend();
  });
  ctx.on('fps', (v) => { el.fps.textContent = `${v} fps${ctx.mock ? ' · MOCK DATA' : ''}`; });

  // ---- speedometer
  const num = el.speedo.querySelector('b');
  let shownSpeed = -1;
  ctx.on('update', () => {
    const mph = Math.round(Math.abs(ctx.car.state.speed) * 2.237);
    if (mph !== shownSpeed) { shownSpeed = mph; num.textContent = mph; }
  });

  // ---- legend and kind filters (keys 1 to 4)
  function renderLegend() {
    const L = ctx.listingsSys;
    if (!L || !ctx.world) return;
    const counts = {};
    for (const l of ctx.world.listings) counts[l.kind] = (counts[l.kind] || 0) + 1;
    el.legend.innerHTML = L.KINDS.map((k, i) => `<button data-kind="${k}" class="${L.visible[k] ? 'on' : ''}"><kbd>${i + 1}</kbd><i style="background:${KIND_COLOR[k]}"></i>${KIND_LABEL[k]} <em>${counts[k] || 0}</em></button>`).join('');
    for (const b of el.legend.children) b.addEventListener('click', () => { b.blur(); L.toggle(b.dataset.kind); });
  }
  ctx.on('filters', renderLegend);

  // ---- listing card
  let current = null;
  // Listing photos live on a remote host that may refuse us (or the wifi may be down), so each
  // city load probes one photo. Local images always work: a still from the home's 3D scan,
  // then the angled aerial photos.
  let remoteOk = false;
  ctx.on('city', (world) => {
    remoteOk = false;
    const first = world.listings.find((l) => (l.photos || []).some((p) => /^https?:/.test(p)));
    const local = world.listings.find((l) => (l.photos || []).some((p) => !/^https?:/.test(p)));
    if (local && !first) { remoteOk = true; return; }
    if (!first || navigator.onLine === false) return;
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.onload = () => { remoteOk = probe.naturalWidth > 8; };
    probe.src = first.photos.find((p) => /^https?:/.test(p));
  });
  async function interiorStills(l) {
    if (l._stills) return l._stills;
    l._stills = [];
    const id = (l.matterportIds || [])[0];
    if (!id) return l._stills;
    try {
      const res = await fetch(`${ctx.world.base}mp/${id}.json`);
      if (res.ok && !(res.headers.get('content-type') || '').includes('html')) {
        const j = await res.json();
        l._stills = j.panos.slice(0, 3).map((p) => `${p.faces}_1.jpg`);
      }
    } catch { /* no local scan */ }
    return l._stills;
  }
  function photoSources(l) {
    const abs = (p) => (/^https?:/.test(p) ? p : ctx.world.base + p);
    const listing = [...(l.localPhotos || []), ...(l.photos || [])].filter((p) => remoteOk || !/^https?:/.test(p));
    return [...listing.slice(0, 3), ...(l._stills || []), ...(l.curbPhotos || [])].map(abs);
  }
  function photoTag(l) {
    const srcs = photoSources(l);
    if (!srcs.length) return '<div class="photo none"></div>';
    return `<div class="photo"><img referrerpolicy="no-referrer" src="${esc(srcs[0])}" data-alt='${esc(JSON.stringify(srcs.slice(1, 5)))}' alt=""/></div>`;
  }
  function showCard(l) {
    current = l;
    if (!l) { el.card.classList.remove('show'); return; }
    if (!l._stills) interiorStills(l).then((st) => { if (current === l && st.length) showCard(l); });
    const saved = ctx.saved?.has(l.id);
    const badges = aerialBadges(l).slice(0, 5).map((b) => `<li>${icon(b.icon)}${esc(b.text)}</li>`).join('');
    const curb = (l.curbPhotos || []).map((p) => `<img class="clickable" src="${esc(ctx.world.base + p)}" alt="" loading="lazy"/>`).join('');
    const plans = (l.floorPlans || []).slice(0, 5).map((f) => `<tr><td>${esc(f.name || 'Plan')}</td><td>${f.beds === 0 ? 'Studio' : f.beds != null ? f.beds + ' bd' : ''}</td><td>${f.rentMin ? money(f.rentMin) + (f.rentMax && f.rentMax !== f.rentMin ? ' to ' + money(f.rentMax) : '') : ''}</td><td>${f.unitsAvailable ? f.unitsAvailable + ' open' : ''}</td></tr>`).join('');
    const disagree = l.vexcel?.poolDetected && !l.listingPool ? '<p class="note">The listing does not mention a pool, but the aerial view shows one.</p>' : '';
    const canTour = (l.matterportIds || []).length > 0;
    el.card.innerHTML = `
      ${photoTag(l)}
      <div class="body">
        <div class="kind" style="--k:${KIND_COLOR[l.kind]}">${esc(l.status || KIND_LABEL[l.kind])}</div>
        <div class="price">${esc(priceText(l))}<small>${l.kind === 'sale' || l.kind === 'apartments' || l.kind === 'rent' ? '' : esc(l.priceLabel || '')}</small></div>
        <div class="facts">${esc(factsText(l))}</div>
        <div class="addr">${l.name ? `<b>${esc(l.name)}</b> · ` : ''}${esc(l.address)}${l.city ? ', ' + esc(l.city) : ''}</div>
        ${(l.highlights || []).length ? `<ul class="tags">${l.highlights.slice(0, 4).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${plans ? `<table class="plans">${plans}</table>` : ''}
        ${badges ? `<div class="sub">Seen from above</div><ul class="badges">${badges}</ul>` : ''}
        ${disagree}
        ${curb ? `<div class="curb">${curb}</div>` : ''}
        <div class="prompts">
          ${canTour ? '<span class="clickable" data-act="tour"><kbd>E</kbd> Walk inside</span>' : '<span class="dim">No 3D tour</span>'}
          ${l.splat ? '<span class="clickable" data-act="drone"><kbd>Q</kbd> Drone view</span>' : ''}
          <span class="clickable" data-act="save"><kbd>F</kbd> ${saved ? 'Saved' : 'Save'}</span>
        </div>
      </div>`;
    el.card.classList.add('show');
    const img = el.card.querySelector('.photo img');
    if (img) {
      let alts = [];
      try { alts = JSON.parse(img.dataset.alt || '[]'); } catch { /* ignore */ }
      img.addEventListener('error', () => { if (alts.length) img.src = alts.shift(); else img.parentElement.classList.add('none'); });
    }
    for (const c of el.card.querySelectorAll('.curb img')) c.addEventListener('click', () => lightbox(c.src));
    el.card.querySelector('[data-act="tour"]')?.addEventListener('click', () => ctx.emit('key', 'KeyE', null));
    el.card.querySelector('[data-act="save"]')?.addEventListener('click', () => ctx.emit('key', 'KeyF', null));
    el.card.querySelector('[data-act="drone"]')?.addEventListener('click', () => ctx.emit('key', 'KeyQ', null));
  }
  ctx.on('near-listing', (l) => { showCard(l); if (l) showCommercial(null); });
  ctx.on('saved', () => { if (current) showCard(current); el.saved.querySelector('b').textContent = ctx.saved.size; el.saved.classList.toggle('has', ctx.saved.size > 0); });
  el.saved.addEventListener('click', () => ctx.emit('key', 'Tab', null));

  function showCommercial(c) {
    if (!c) { el.ccard.classList.remove('show'); return; }
    const sale = c.lastSale ? `Last sold ${esc(String(c.lastSale.date).slice(0, 4))}${c.lastSale.price ? ' for ' + money(c.lastSale.price) : ''}` : '';
    el.ccard.innerHTML = `<div class="body"><div class="kind" style="--k:#9aa3ad">${esc(c.type || 'Commercial')}</div>
      <div class="cname">${esc(c.name || c.address || 'Commercial property')}</div>
      <div class="facts">${[c.sqft ? Number(c.sqft).toLocaleString('en-US') + ' sqft' : '', c.stories ? c.stories + ' stories' : '', c.tenants ? c.tenants + ' tenants' : ''].filter(Boolean).join(' · ')}</div>
      ${sale ? `<div class="addr">${sale}</div>` : ''}</div>`;
    el.ccard.classList.add('show');
  }
  ctx.on('near-commercial', (c) => showCommercial(ctx.listingsSys?.near ? null : c));

  // ---- captions, toasts, arrow
  let capTimer = 0, toastTimer = 0;
  function caption(text, ms = 5200) {
    clearTimeout(capTimer);
    if (!text) { el.caption.classList.remove('show'); return; }
    el.caption.textContent = text;
    el.caption.classList.add('show');
    capTimer = setTimeout(() => el.caption.classList.remove('show'), ms);
  }
  function live(text, listening = true) {
    if (text == null) { el.live.classList.remove('show'); return; }
    el.live.querySelector('.txt').textContent = text || 'Listening...';
    el.live.classList.toggle('on', listening);
    el.live.classList.add('show');
  }
  function toast(text, ms = 2200) {
    clearTimeout(toastTimer);
    el.toast.textContent = text;
    el.toast.classList.add('show');
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }
  function arrow(info) {
    if (!info) { el.arrow.classList.remove('show'); return; }
    el.arrow.classList.add('show');
    el.arrow.querySelector('.needle').style.transform = `rotate(${info.angle}rad)`;
    el.arrow.querySelector('b').textContent = info.dist >= 1000 ? (info.dist / 1000).toFixed(1) + ' km' : Math.round(info.dist / 5) * 5 + ' m';
    el.arrow.querySelector('span').textContent = info.label || '';
  }

  // ---- numbered chooser (floor plans, ratings)
  let choice = null;
  function choose(title, options, cb, note = '') {
    choice = { options, cb };
    el.chooser.innerHTML = `<div class="body"><div class="sub">${esc(title)}</div>${options.map((o, i) => `<button data-i="${i}"><kbd>${o.key || i + 1}</kbd><span>${esc(o.label)}</span><em>${esc(o.detail || '')}</em></button>`).join('')}${note ? `<p class="note">${esc(note)}</p>` : ''}</div>`;
    el.chooser.classList.add('show');
    for (const b of el.chooser.querySelectorAll('button')) b.addEventListener('click', () => pick(Number(b.dataset.i)));
  }
  function pick(i) {
    if (!choice || !choice.options[i]) return false;
    const { cb, options } = choice;
    closeChooser();
    cb(options[i], i);
    return true;
  }
  function closeChooser() { choice = null; el.chooser.classList.remove('show'); }
  ctx.on('key', (code) => {
    if (!choice) return;
    if (code === 'Escape') { const c = choice; closeChooser(); c.cb(null, -1); return; }
    const idx = choice.options.findIndex((o, i) => code === (o.code || `Digit${i + 1}`));
    if (idx >= 0) pick(idx);
  });

  function lightbox(src) {
    el.lightbox.querySelector('img').src = src;
    el.lightbox.classList.add('show');
  }
  el.lightbox.addEventListener('click', () => el.lightbox.classList.remove('show'));

  function fade(on, ms = 400, color = '#ffffff') {
    el.fade.style.transitionDuration = ms + 'ms';
    el.fade.style.background = color;
    el.fade.classList.toggle('show', on);
    return new Promise((r) => setTimeout(r, ms));
  }

  setTimeout(() => el.help.classList.add('hide'), 14000);

  return {
    root, $, esc, el, showCard, photoSources, interiorStills, showCommercial, caption, live, toast, arrow, choose, closeChooser, lightbox, fade, renderLegend,
    get choosing() { return !!choice; },
    get current() { return current; },
    setPlayVisible(v) { root.classList.toggle('hidden-play', !v); },
  };
}
