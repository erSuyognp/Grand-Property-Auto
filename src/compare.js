// Saved homes screen (Tab): up to 4 homes side by side with the numbers a buyer weighs: price,
// true monthly cost, price per sqft against nearby homes, scores, drive time to your places,
// HOA, solar savings and risk. The best value in each row is marked (a star, not only color),
// Maya names her pick with the reason, and the shortlist prints as a one page report.
import { KIND_COLOR, KIND_LABEL, money, priceText } from './format.js';
import { icon } from './icons.js';
import { SCORE_COLOR } from './panel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => (n == null ? null : '$' + Math.round(n).toLocaleString('en-US'));
const NA = '<span class="na">Not available</span>';
const SCORES = [['value', 'Value'], ['errands', 'Errands'], ['commute', 'Commute'], ['outdoors', 'Outdoors'], ['energy', 'Energy'], ['risk', 'Low risk'], ['activity', 'Street life']];

export function initCompare(ctx) {
  const el = document.createElement('div');
  el.id = 'compare';
  const report = document.createElement('div');
  report.id = 'report';
  document.body.append(el, report);
  let open = false, prev = 'play';

  const row = (id) => ctx.insights.row(id) || {};
  const monthly = (h) => { const r = row(h.id); return r.cost ?? r.rent ?? null; };
  function homes() { return ctx.saved.list().slice(-4); }

  // Maya's pick: the saved home that best fits what the player said they want
  function pick(list) {
    if (list.length < 2) return null;
    const prefs = ctx.maya?.prefs || [];
    const want = Object.assign({}, ...prefs);
    let best = null;
    for (const h of list) {
      const r = row(h.id), why = [];
      let s = (r.scores?.value ?? 50) * 0.5 + (r.scores?.errands ?? 50) * 0.15 + (r.scores?.risk ?? 50) * 0.15;
      const tier = ctx.buyer?.tierOf(h);
      if (tier === 'comfortable') { s += 30; why.push('it fits your comfortable budget'); } else if (tier === 'out') s -= 30;
      if (want.maxPrice && h.price) { if (h.price <= want.maxPrice) { s += 15; why.push(`it is under your ${money(want.maxPrice)} budget`); } else s -= 25; }
      if (want.minBeds && (h.beds ?? 0) >= want.minBeds) s += 8;
      if (want.pool && r.pool) { s += 14; why.push('it has the pool you asked for'); }
      if (want.outdoors && r.parkWalk != null && r.parkWalk <= 8) { s += 10; why.push(`a park is ${r.parkWalk} minutes on foot`); }
      if (want.solar && r.solarSave) { s += 10; why.push(`solar could save ${usd(r.solarSave)} a year`); }
      if (ctx.buyer?.places.length) { const w = ctx.buyer.weekly(h), min = Math.min(...list.map((x) => ctx.buyer.weekly(x))); if (w === min) { s += 12; why.push('it has the shortest drive to your places'); } }
      if (r.lowerThanPct != null && r.lowerThanPct >= 60) why.push(`it is priced lower than ${r.lowerThanPct}% of similar homes nearby`);
      const m = monthly(h), minM = Math.min(...list.map((x) => monthly(x) ?? Infinity));
      if (m != null && m === minM) { s += 6; why.push(`it has the lowest monthly cost, about ${usd(m)}`); }
      if (!best || s > best.s) best = { h, s, why };
    }
    return best;
  }

  function render() {
    const list = homes(), extra = ctx.saved.size - list.length;
    const cell = (v) => v ?? NA;
    // which home wins a row: dir 1 = lower is better, -1 = higher is better
    const winner = (fn, dir) => { let b = null, bi = -1, n = 0; list.forEach((h, i) => { const v = fn(h); if (v == null) return; n++; if (b == null || v * dir < b * dir) { b = v; bi = i; } }); return n > 1 ? bi : -1; };
    const line = (label, fmt, val, dir, note = '') => {
      const w = dir ? winner(val, dir) : -1;
      return `<tr><th>${label}${note ? `<small>${note}</small>` : ''}</th>${list.map((h, i) => `<td class="${i === w ? 'win' : ''}">${i === w ? `<span class="best" title="Best in this row">${icon('star', 12)}</span>` : ''}${cell(fmt(h))}</td>`).join('')}</tr>`;
    };
    const mp = pick(list);
    const places = ctx.buyer?.places || [];
    el.innerHTML = `<div class="sheet panel"><div class="head"><h2>Compare your saved homes</h2><span>${list.length ? `${list.length} home${list.length > 1 ? 's' : ''}${extra > 0 ? ` (the last 4 of ${ctx.saved.size} saved)` : ''}` : ''}</span>
        ${list.length ? `<button class="print act">${icon('printer', 15)}Print shortlist</button>` : ''}<button class="close"><kbd>Tab</kbd> Back to the car</button></div>
      ${mp ? `<p class="mpick">${icon('sparkles', 16)}<b>Maya's pick for you:</b> the ${esc(mp.h.price != null ? money(mp.h.price) : priceText(mp.h))} ${mp.h.beds != null ? mp.h.beds + ' bed' : 'home'}${mp.why.length ? ', because ' + esc(mp.why.slice(0, 2).join(' and ')) : ''}.</p>` : ''}
      ${list.length ? `<div class="scroll"><table>
        <tr class="photos"><th></th>${list.map((h) => { const src = ctx.hud.photoSources(h)[0]; return `<td>${src ? `<img referrerpolicy="no-referrer" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'"/>` : '<div class="ph"></div>'}</td>`; }).join('')}</tr>
        ${line('', (h) => `<span class="kind" style="--k:${KIND_COLOR[h.kind]}">${esc(h.status || KIND_LABEL[h.kind])}</span>${mp && mp.h === h ? `<span class="pickchip">${icon('sparkles', 11)}Maya's pick</span>` : ''}`)}
        ${line('Price', (h) => `<b class="big">${esc(priceText(h))}</b>`, (h) => h.price ?? null, 1)}
        ${line('True monthly cost', (h) => (monthly(h) != null ? `<b>${usd(monthly(h))}</b>${row(h.id).cost != null ? ' <em class="est">Estimate</em>' : ' rent'}` : null), monthly, 1, '20% down')}
        ${ctx.buyer?.aff ? line('Your budget', (h) => { const t = ctx.buyer.tierOf(h); return t ? { comfortable: `${icon('check', 13)} Comfortable`, stretch: `${icon('triangle-alert', 13)} A stretch`, out: `${icon('x', 13)} Out of range` }[t] : null; }) : ''}
        ${line('Address', (h) => esc(h.name ? `${h.name}, ${h.address}` : h.address))}
        ${line('Beds / baths', (h) => (h.beds != null ? `${h.beds} / ${h.baths ?? '?'}` : h.floorPlans?.length ? `${h.floorPlans.length} floor plans` : null))}
        ${line('Size', (h) => (h.sqft ? `${Number(h.sqft).toLocaleString('en-US')} sqft` : null), (h) => h.sqft || null, -1)}
        ${line('Price per sqft', (h) => { const r = row(h.id); return r.ppsf ? `${usd(r.ppsf)}${r.lowerThanPct != null ? `<small>lower than ${r.lowerThanPct}% nearby</small>` : ''}` : null; }, (h) => row(h.id).lowerThanPct ?? null, -1, 'against similar homes nearby')}
        ${line('Scores', (h) => { const s = row(h.id).scores || {}; return `<div class="minis">${SCORES.filter(([k]) => s[k] != null).map(([k, label]) => `<span title="${label} ${s[k]} of 100"><i>${label}</i><u><b style="width:${s[k]}%;background:${SCORE_COLOR[k] || '#fff'}"></b></u><em>${s[k]}</em></span>`).join('')}</div>`; })}
        ${places.map((p) => line(`Drive to ${esc(p.name)}`, (h) => `${ctx.buyer.driveTo(h).find((x) => x.name === p.name)?.min} min <em class="est">Estimate</em>`, (h) => ctx.buyer.driveTo(h).find((x) => x.name === p.name)?.min ?? null, 1)).join('')}
        ${line('Downtown', (h) => (row(h.id).downtownMin != null ? `${row(h.id).downtownMin} min drive` : null), (h) => row(h.id).downtownMin ?? null, 1)}
        ${line('HOA', (h) => (h.hoa ? `${usd(h.hoa)} /mo` : h.kind === 'apartments' ? null : 'None listed'), (h) => (h.kind === 'apartments' ? null : h.hoa || 0), 1)}
        ${line('Electric bill', (h) => (row(h.id).bill != null ? `${usd(row(h.id).bill)} /mo <em class="est">Estimate</em>` : null), (h) => row(h.id).bill ?? null, 1)}
        ${line('Solar savings', (h) => (row(h.id).solarSave ? `${usd(row(h.id).solarSave)} a year` : 'Not available'), (h) => row(h.id).solarSave ?? null, -1)}
        ${line('Risk', (h) => { const r = row(h.id); return r.riskTier ? `Hazard pressure ${esc(r.riskTier)}<small>${r.sfha ? 'In a high risk flood zone' : r.floodZone ? 'Flood zone ' + esc(r.floodZone) : ''}</small>` : null; }, (h) => row(h.id).riskScore ?? null, 1, 'FEMA')}
        ${line('Seen from above', (h) => { const r = row(h.id); return [r.pool ? 'Pool' : '', r.tree >= 10 ? `${r.tree}% trees` : '', r.roof ? `Roof ${r.roof}/5` : ''].filter(Boolean).join(' · ') || null; })}
        ${line('', (h) => `<button class="rm" data-id="${esc(h.id)}">Remove</button> <button class="goto" data-id="${esc(h.id)}">Take me there</button>`)}
      </table><p class="cfine">${icon('star', 12)} marks the best value in a row. Monthly cost, electric bill, solar and drive times are estimates. Not financial, legal or insurance advice.</p></div>` : '<p class="empty">Nothing saved yet. Select a home and press <kbd>F</kbd>, or give it a thumbs up after a tour.</p>'}
    </div>`;
    el.querySelector('.close').addEventListener('click', hide);
    el.querySelector('.print')?.addEventListener('click', print);
    for (const b of el.querySelectorAll('.rm')) b.addEventListener('click', () => { const l = ctx.saved.list().find((x) => x.id === b.dataset.id); if (l) ctx.saved.remove(l); });
    for (const b of el.querySelectorAll('.goto')) b.addEventListener('click', () => {
      const l = ctx.saved.list().find((x) => x.id === b.dataset.id);
      hide();
      if (l) { ctx.reveal?.close(); ctx.missions.goTo(l); }
    });
    window.__gpa.compare = { open: true, homes: list.map((h) => h.id), pick: mp?.h.id || null };
  }

  // one page shortlist, printed (or saved as PDF) by the browser: nothing is uploaded
  async function print() {
    const list = homes();
    const full = await Promise.all(list.map((h) => ctx.insights.get(h.id)));
    const src = (k) => ctx.insights.source(k);
    report.innerHTML = `<h1>Shortlist</h1><p class="rsub">${esc(ctx.world.area.name)} · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · made with Grand Property Auto</p>
      <table><tr><th></th>${list.map((h) => `<th>${esc(h.name || h.address)}<small>${esc(h.status || KIND_LABEL[h.kind])}</small></th>`).join('')}</tr>
      ${[['Price', (h) => priceText(h) + (full[list.indexOf(h)]?.facts?.askingOnly ? ' (last asking price)' : '')],
        ['Beds / baths / size', (h) => `${h.beds ?? '-'} / ${h.baths ?? '-'} / ${h.sqft ? Number(h.sqft).toLocaleString('en-US') + ' sqft' : '-'}`],
        ['Monthly cost (Estimate)', (h, d) => (d?.cost ? `${usd(d.cost.total)}: loan ${usd(d.cost.mortgage)}, tax ${usd(d.cost.tax)}, insurance ${usd(d.cost.insurance)}, HOA ${usd(d.cost.hoa)}, electric ${usd(d.cost.electric)}` : row(h.id).rent ? `Rent from ${usd(row(h.id).rent)}` : 'Not available')],
        ['Price per sqft', (h, d) => (d?.value ? `${usd(d.value.ppsf)}, lower than ${d.value.lowerThanPct}% of ${d.value.n} similar homes nearby` : 'Not available')],
        ['Renting nearby', (h, d) => (d?.rentVsBuy ? `Similar ${d.rentVsBuy.beds} bed: about ${usd(d.rentVsBuy.medianRent)} a month` : 'Not available')],
        ['Electric and solar (Estimate)', (h, d) => (d?.energy ? `${usd(d.energy.billMonth)} a month` + (d.solar?.panels ? `; solar could save ${usd(d.solar.savingsYear)} a year` : '') : 'Not available')],
        ['Risk', (h, d) => (d?.risk ? `${d.risk.nri?.rating || 'Not available'}; ${d.risk.flood?.label || 'flood zone not available'}` : 'Not available')],
        ['Nearest', (h, d) => ['supermarket', 'park', 'school', 'transit'].map((c) => { const p = d?.places?.[c]?.[0]; return p ? `${p.name} ${p.walkMin} min walk` : ''; }).filter(Boolean).join('; ') || 'Not available'],
        ...(ctx.buyer?.places || []).map((p) => [`Drive to ${p.name} (Estimate)`, (h) => `${ctx.buyer.driveTo(h).find((x) => x.name === p.name)?.min} min`]),
        ['Scores (0 to 100)', (h) => SCORES.filter(([k]) => row(h.id).scores?.[k] != null).map(([k, label]) => `${label} ${row(h.id).scores[k]}`).join(', ')],
      ].map(([label, fn]) => `<tr><th>${esc(label)}</th>${list.map((h, i) => `<td>${esc(fn(h, full[i]))}</td>`).join('')}</tr>`).join('')}</table>
      <h2>Where the numbers come from</h2><ul>${['value', 'cost', 'tax', 'insurance', 'energy', 'solar', 'risk', 'places'].map((k) => (src(k) ? `<li><b>${esc(src(k).name)}</b>${src(k).date ? ` (${esc(src(k).date)})` : ''}: ${esc(src(k).how)}</li>` : '')).join('')}</ul>
      <p class="rfine">Estimates are labeled. Not financial, legal or insurance advice. This page was made on this computer and was not uploaded anywhere.</p>`;
    window.__gpa.report = { homes: list.length, text: report.innerText.length };
    if (!ctx.params.has('noprint')) window.print();
  }

  function show() {
    if (open || (ctx.state !== 'play' && ctx.state !== 'compare')) return;
    open = true; prev = ctx.state === 'compare' ? 'play' : ctx.state;
    ctx.state = 'compare';
    render();
    el.classList.add('show');
    ctx.audio.whoosh?.(0.4);
  }
  function hide() {
    if (!open) return;
    open = false;
    el.classList.remove('show');
    ctx.state = prev;
    if (window.__gpa.compare) window.__gpa.compare.open = false;
  }
  ctx.on('key', (code) => {
    if (code === 'Tab') { if (open) hide(); else if (ctx.state === 'play' && !ctx.hud.choosing) show(); } else if (code === 'Escape' && open) hide();
  });
  ctx.on('saved', () => { if (open) render(); });
  return { show, hide, print, pick: () => pick(homes()), get open() { return open; } };
}
