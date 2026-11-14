// Saved homes screen (Tab): side by side compare, cheapest first.
import { KIND_COLOR, KIND_LABEL, aerialBadges, money, priceText, priceValue } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initCompare(ctx) {
  const el = document.createElement('div');
  el.id = 'compare';
  document.body.append(el);
  let open = false, prev = 'play';

  function render() {
    const homes = ctx.saved.list().sort((a, b) => {
      const ra = a.price == null, rb = b.price == null;
      return ra === rb ? priceValue(a) - priceValue(b) : ra ? 1 : -1; // homes for sale first, then rentals; each cheapest first
    });
    const row = (label, fn) => `<tr><th>${label}</th>${homes.map((h) => `<td>${fn(h) ?? '<span class="na">n/a</span>'}</td>`).join('')}</tr>`;
    const best = (fn, dir = 1) => { let b = null; for (const h of homes) { const v = fn(h); if (v != null && (b == null || v * dir < b * dir)) b = v; } return b; };
    const cheapest = best((h) => (h.price != null ? h.price : null));
    const biggest = best((h) => h.sqft || null, -1);
    el.innerHTML = `<div class="sheet panel"><div class="head"><h2>Your saved homes</h2><span>${homes.length ? 'Cheapest first' : ''}</span><button class="close"><kbd>Tab</kbd> Back to the car</button></div>
      ${homes.length ? `<div class="scroll"><table>
        <tr class="photos"><th></th>${homes.map((h) => { const src = ctx.hud.photoSources(h)[0]; return `<td>${src ? `<img referrerpolicy="no-referrer" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'"/>` : '<div class="ph"></div>'}</td>`; }).join('')}</tr>
        ${row('', (h) => `<span class="kind" style="--k:${KIND_COLOR[h.kind]}">${esc(h.status || KIND_LABEL[h.kind])}</span>`)}
        ${row('Price', (h) => `<b class="big${h.price != null && h.price === cheapest && homes.length > 1 ? ' win' : ''}">${esc(priceText(h))}</b>`)}
        ${row('Address', (h) => esc(h.name ? `${h.name}, ${h.address}` : h.address))}
        ${row('Beds / baths', (h) => (h.beds != null ? `${h.beds} / ${h.baths ?? '?'}` : h.floorPlans?.length ? `${h.floorPlans.length} floor plans` : null))}
        ${row('Size', (h) => (h.sqft ? `<span class="${h.sqft === biggest && homes.length > 1 ? 'win' : ''}">${Number(h.sqft).toLocaleString('en-US')} sqft</span>` : null))}
        ${row('Price per sqft', (h) => (h.price && h.sqft ? money(h.price / h.sqft) : null))}
        ${row('Lot', (h) => (h.lotAcres ? `${h.lotAcres} acres` : null))}
        ${row('Built', (h) => h.yearBuilt || null)}
        ${row('HOA', (h) => (h.hoa ? `${money(h.hoa)} /mo` : h.kind === 'apartments' ? null : 'None listed'))}
        ${row('Seen from above', (h) => aerialBadges(h).slice(0, 4).map((b) => esc(b.text)).join('<br>') || null)}
        ${row('Highlights', (h) => (h.highlights || []).slice(0, 3).map(esc).join('<br>') || null)}
        ${row('', (h) => `<button class="rm" data-id="${esc(h.id)}">Remove</button> <button class="goto" data-id="${esc(h.id)}">Take me there</button>`)}
      </table></div>` : '<p class="empty">Nothing saved yet. Pull up to a home and press <kbd>F</kbd>, or give it a thumbs up after a tour.</p>'}
    </div>`;
    el.querySelector('.close').addEventListener('click', hide);
    for (const b of el.querySelectorAll('.rm')) b.addEventListener('click', () => { const l = ctx.saved.list().find((x) => x.id === b.dataset.id); if (l) ctx.saved.remove(l); });
    for (const b of el.querySelectorAll('.goto')) b.addEventListener('click', () => {
      const l = ctx.saved.list().find((x) => x.id === b.dataset.id);
      hide();
      if (l) ctx.missions.goTo(l);
    });
  }
  function show() {
    if (open || (ctx.state !== 'play' && ctx.state !== 'compare')) return;
    open = true; prev = ctx.state === 'compare' ? 'play' : ctx.state;
    ctx.state = 'compare';
    render();
    el.classList.add('show');
  }
  function hide() {
    if (!open) return;
    open = false;
    el.classList.remove('show');
    ctx.state = prev;
  }
  ctx.on('key', (code) => {
    if (code === 'Tab') { if (open) hide(); else if (ctx.state === 'play' && !ctx.hud.choosing) show(); } else if (code === 'Escape' && open) hide();
  });
  ctx.on('saved', () => { if (open) render(); });
  return { show, hide, get open() { return open; } };
}
