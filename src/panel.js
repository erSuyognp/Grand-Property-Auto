// The insight panel that slides in from the right when a home is selected. One card per
// topic: a plain language headline, one small chart, a score ring and an "i" button that shows
// the source, the date and how the number was worked out. Calculated numbers say "Estimate".
import { KIND_COLOR, KIND_LABEL, factsText, money, priceText } from './format.js';
import { icon, PLACE_ICON, PLACE_LABEL } from './icons.js';
import { costFor, affordTier } from './costmath.js';
import { formatDistance } from './settings.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => (n == null || !Number.isFinite(n) ? 'Not available' : '$' + Math.round(n).toLocaleString('en-US'));
const NA = '<span class="na">Not available</span>';

export const SCORE_COLOR = { value: '#ffc940', cost: '#ff8f5a', errands: '#ffb020', commute: '#4cc9f0', outdoors: '#3ddc84', energy: '#ffe14d', risk: '#ff6b6b', activity: '#c59bff', schools: '#7c9cff', hoa: '#9be7ff', income: '#b8c4d6', noise: '#a3b1c6', rent: '#3aa0ff', light: '#ffd27a' };
const COST_PARTS = [['mortgage', 'Loan payment', '#ff8f5a'], ['tax', 'Property tax', '#ffc940'], ['insurance', 'Insurance', '#4cc9f0'], ['hoa', 'HOA', '#c59bff'], ['electric', 'Electric', '#3ddc84']];

function ring(score, color) {
  if (score == null) return '<div class="ring na" title="Not available"><span>n/a</span></div>';
  const c = 2 * Math.PI * 17;
  return `<div class="ring" style="--c:${color}" role="img" aria-label="Score ${score} out of 100"><svg viewBox="0 0 40 40" width="46" height="46"><circle cx="20" cy="20" r="17" class="bg"/><circle cx="20" cy="20" r="17" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-to="${c * (1 - score / 100)}"/></svg><b data-count="${score}">0</b></div>`;
}

export function initPanel(ctx) {
  const el = document.createElement('aside');
  el.id = 'ipanel';
  el.setAttribute('aria-label', 'Home insights');
  ctx.hud.root.append(el);
  let cur = null, ins = null, opts = { downPct: 20, solarOn: false }, openInfo = new Set();
  const dist = (m) => formatDistance(m, ctx.settings?.units);
  try { const d = Number(localStorage.getItem('gpa-down')); if ([3.5, 10, 20].includes(d)) opts.downPct = d; } catch { /* private mode */ }

  const src = (...keys) => keys.map((k) => { const s = ctx.insights.source(k); return s ? `<p><b>${esc(s.name)}</b>${s.date ? ` · ${esc(s.date)}` : ''}<br>${esc(s.how)}</p>` : ''; }).join('');
  function card(key, o) {
    const color = SCORE_COLOR[key] || '#fff';
    return `<section class="icard" data-card="${key}" style="--c:${color}">
      <header><span class="cic">${icon(o.icon, 18)}</span><h3>${esc(o.title)}</h3>${o.est ? '<em class="est">Estimate</em>' : ''}
        <button class="ibtn" data-info="${key}" aria-label="Where ${esc(o.title)} comes from" aria-expanded="false">${icon('info', 16)}</button>${o.noRing ? '' : ring(o.score, color)}</header>
      <p class="headline">${o.headline}</p>
      ${o.body || ''}
      <div class="isrc" hidden>${src(...(o.src || [key]))}${o.reason ? `<p><b>Score</b><br>${esc(o.reason)}. ${esc(ctx.insights.source('scores')?.how || '')}</p>` : ''}</div>
    </section>`;
  }
  const row = (ic, label, val) => `<li>${icon(ic, 15)}<span>${label}</span><b>${val}</b></li>`;
  const bar = (pct, color) => `<div class="hbar"><i style="width:${Math.max(2, Math.min(100, pct))}%;background:${color || 'var(--c)'}"></i></div>`;

  // ---- the cards
  function valueCard(l, d) {
    const v = d.value, f = d.facts;
    if (!f.ppsf) return '';
    let body = '', headline = `${usd(f.ppsf)} per square foot`;
    if (v && v.n >= 2) {
      headline = `Priced lower than <b data-count="${v.lowerThanPct}">0</b><b>%</b> of similar homes nearby`;
      const all = [...v.comps.map((c) => c.ppsf), v.ppsf], lo = Math.min(...all), hi = Math.max(...all), pos = (x) => 4 + (92 * (x - lo)) / Math.max(1, hi - lo);
      body = `<div class="strip" role="img" aria-label="Price per square foot against ${v.comps.length} nearby homes">
          ${v.comps.map((c) => `<i style="left:${pos(c.ppsf)}%" title="${usd(c.price)} · ${c.beds ?? '?'} bd · ${c.sqft} sqft · ${c.status}"></i>`).join('')}
          <i class="me" style="left:${pos(v.ppsf)}%"></i><span class="lo">${usd(lo)}</span><span class="hi">${usd(hi)} /sqft</span></div>
        <table class="comps"><tr><th>Nearby</th><th>Beds</th><th>Sq ft</th><th>$/sqft</th><th></th></tr>
          <tr class="me"><td>${usd(f.price)} <small>this home</small></td><td>${f.beds ?? ''}</td><td>${f.sqft?.toLocaleString('en-US') ?? ''}</td><td>${usd(v.ppsf)}</td><td></td></tr>
          ${v.comps.slice(0, 5).map((c) => `<tr><td>${usd(c.price)}</td><td>${c.beds ?? ''}</td><td>${c.sqft?.toLocaleString('en-US') ?? ''}</td><td>${usd(c.ppsf)}</td><td><small>${esc(c.status)} · ${dist(c.distM)}</small></td></tr>`).join('')}</table>
        <p class="fine">${v.n} ${v.type ? esc(v.type.toLowerCase()) + 's' : 'homes'} within ${v.radiusKm} km, for sale now or sold in the last year.</p>`;
    } else body = `<p class="fine">Not enough similar homes nearby to compare.</p>`;
    if (f.askingOnly) body += `<p class="fine warn">${icon('info', 13)} Texas does not disclose sale prices: this is the last asking price.</p>`;
    const hist = (d.home?.priceHistory || []).slice(-3);
    if (hist.length || f.daysOnMarket != null) {
      body += `<ul class="timeline">${hist.map((h) => { const delta = h.to - h.from; const days = Math.round((Date.now() - new Date(h.date)) / 864e5); return `<li class="${delta < 0 ? 'down' : 'up'}">${icon(delta < 0 ? 'trending-down' : 'activity', 14)}Price ${delta < 0 ? 'cut' : 'raised'} ${money(Math.abs(delta))}<small>${days > 0 ? days + ' days ago' : esc(h.date)}</small></li>`; }).join('')}
        ${f.daysOnMarket != null ? `<li>${icon('clock', 14)}${f.daysOnMarket} days on the market</li>` : ''}</ul>`;
    }
    return card('value', { icon: 'scale', title: 'Price and value', score: d.scores?.value?.score, reason: d.scores?.value?.reason, headline, body, src: ['value'] });
  }

  function setDown(p) {
    opts.downPct = p;
    try { localStorage.setItem('gpa-down', String(p)); } catch { /* private mode */ }
    ctx.emit('down-payment', p);
    refreshCost();
  }
  function costBody(l, d) {
    const solar = d.solar?.panels ? d.solar : null;
    // Panels already on the roof are not a second saving. The electric line is a state average.
    const addSolar = !!(solar && !solar.existing && opts.solarOn);
    const c = costFor(d, { downPct: opts.downPct, solarOn: addSolar });
    const total = c.total;
    const segs = COST_PARTS.filter(([k]) => c[k] > 0);
    const sum = segs.reduce((a, [k]) => a + c[k], 0) || 1;
    const rv = d.rentVsBuy;
    const aff = ctx.buyer?.affordLine?.(total) || '';
    const partsSum = segs.reduce((a, [k]) => a + c[k], 0) + (c.solar || 0);
    return `<p class="headline"><b class="bigno" data-count="${total}" data-prefix="$">$0</b> a month <em class="est">Estimate</em></p>
      <div class="stack" role="img" aria-label="Monthly cost parts">${segs.map(([k, label, col]) => `<i style="flex:${c[k] / sum};background:${col}" title="${label} ${usd(c[k])}"></i>`).join('')}</div>
      <ul class="legend2">${segs.map(([k, label, col]) => `<li><i style="background:${col}"></i>${label}<b>${usd(c[k])}</b></li>`).join('')}${c.solar ? `<li><i style="background:#ffe14d"></i>Solar savings<b>-${usd(-c.solar)}</b></li>` : ''}</ul>
      <div class="ctrl"><span>Down payment</span><div class="seg" role="group" aria-label="Down payment">${[3.5, 10, 20].map((p) => `<button data-down="${p}" class="${opts.downPct === p ? 'on' : ''}" aria-pressed="${opts.downPct === p}">${p}%</button>`).join('')}</div><small>${usd(c.down)} down</small></div>
      ${solar && !solar.existing ? `<label class="ctrl tog"><input type="checkbox" data-solar ${addSolar ? 'checked' : ''}/><span>Add rooftop solar</span><small>saves ${usd(d.cost.solarMonth)} a month</small></label>` : ''}
      ${solar?.existing ? '<p class="fine">Solar panels are already on the roof. The electric line is a state average and does not subtract them.</p>' : ''}
      ${rv ? `<p class="versus">${icon('building-2', 15)}Renting a similar ${rv.beds} bed nearby: about <b>${usd(rv.medianRent)}</b> a month <small>(${total > rv.medianRent ? usd(total - rv.medianRent) + ' less than owning' : total < rv.medianRent ? usd(rv.medianRent - total) + ' more than owning' : 'the same as owning'})</small></p>` : ''}
      ${aff}
      <p class="fine">${esc(d.cost.taxSource ? 'Property tax: ' + d.cost.taxSource + '. ' : '')}Insurance is the state average, not a quote.${opts.downPct < 20 ? ' Mortgage insurance is not included. Lenders usually charge it when the down payment is under 20%.' : ''} The lines above add up to ${usd(partsSum)}. Not financial, legal or insurance advice.</p>`;
  }
  function costCard(l, d) {
    if (!d.cost) return '';
    return `<section class="icard" data-card="cost" style="--c:${SCORE_COLOR.cost}"><header><span class="cic">${icon('wallet', 18)}</span><h3>True monthly cost</h3>
      <button class="ibtn" data-info="cost" aria-label="Where the monthly cost comes from" aria-expanded="false">${icon('info', 16)}</button></header>
      <div class="costbody">${costBody(l, d)}</div><div class="isrc" hidden>${src('cost', 'tax', 'insurance', 'energy')}</div></section>`;
  }
  function rentCard(l, d) {
    if (d.cost) return '';
    const a = d.apartment, rv = d.rentVsBuy;
    const rent = a ? a.rentMin : d.facts.rent;
    if (!rent && !a) return '';
    const plans = (a?.plans || []).filter((p) => p.rentMin).slice(0, 6);
    const body = `${plans.length ? `<table class="comps"><tr><th>Floor plan</th><th>Beds</th><th>Sq ft</th><th>Rent</th><th>Open</th></tr>${plans.map((p) => `<tr><td>${esc(p.name || 'Plan')}</td><td>${p.beds === 0 ? 'Studio' : p.beds ?? ''}</td><td>${p.sqft || ''}</td><td>${usd(p.rentMin)}${p.rentMax && p.rentMax !== p.rentMin ? ' to ' + usd(p.rentMax) : ''}</td><td>${p.units || ''}</td></tr>`).join('')}</table>` : ''}
      ${a?.unitsAvailable != null ? `<p class="fine">${a.unitsAvailable} of ${a.totalUnits ?? '?'} homes available${a.manager ? ' · managed by ' + esc(a.manager) : ''}${a.yearBuilt ? ' · built ' + a.yearBuilt : ''}</p>` : ''}
      ${rv && !a ? `<p class="versus">${icon('building-2', 15)}A similar ${rv.beds} bed apartment nearby: about <b>${usd(rv.medianRent)}</b> a month</p>` : ''}
      ${ctx.buyer?.affordLine?.(rent) || ''}`;
    return card('rent', { icon: 'wallet', title: 'Rent', score: d.scores?.value?.score, reason: d.scores?.value?.reason, headline: rent ? `From <b class="bigno" data-count="${rent}" data-prefix="$">$0</b> a month` : 'Call for rent', body, src: ['rentVsBuy'] });
  }
  function errandsCard(l, d) {
    const P = d.places || {};
    const line = (cat) => { const p = P[cat]?.[0]; if (!p) return row(PLACE_ICON[cat], PLACE_LABEL[cat], NA); return row(PLACE_ICON[cat], `${PLACE_LABEL[cat]} <small>${esc(p.name !== PLACE_LABEL[cat] ? p.name : '')}</small>`, p.walkMin <= 15 ? `${p.walkMin} min walk` : `${p.driveMin} min drive`); };
    const s1 = d.scores?.errands, s2 = d.scores?.commute, dt = d.drive?.downtown;
    const mine = ctx.buyer?.placeRows?.(l) || '';
    return card('errands', { icon: 'shopping-cart', title: 'Errands and commute', est: true, score: s1 && s2 ? Math.round((s1.score + s2.score) / 2) : (s1 || s2)?.score, reason: [s1?.reason, s2?.reason].filter(Boolean).join('. '),
      headline: esc(s1?.reason || 'Everyday trips'), src: ['places'],
      body: `<ul class="rows">${['supermarket', 'pharmacy', 'cafe', 'gym', 'hospital', 'transit'].map(line).join('')}${dt ? row('car', esc(dt.name), `${dt.min} min drive`) : ''}${mine}</ul>` });
  }
  function outdoorsCard(l, d) {
    const a = d.aerial || {}, p = d.places?.park?.[0], s = d.scores?.outdoors;
    return card('outdoors', { icon: 'trees', title: 'Outdoors', score: s?.score, reason: s?.reason, src: ['places', 'aerial'],
      headline: p ? `${esc(p.name)} is a <b>${p.walkMin} minute walk</b>` : 'No park found nearby',
      body: `<ul class="rows">${row('tree-pine', 'Tree cover on the lot', a.treeCoverPct != null ? a.treeCoverPct + '%' : NA)}${a.treeCoverPct != null ? `<li class="wide">${bar(a.treeCoverPct, '#3ddc84')}</li>` : ''}
        ${row('waves', 'Pool', a.pool ? `Seen from the air${a.poolAreaSqft ? ' · ' + a.poolAreaSqft + ' sq ft' : ''}` : 'None seen from the air')}
        ${a.lotSqft ? row('ruler', 'Lot', `${a.lotSqft.toLocaleString('en-US')} sq ft`) : ''}</ul>${a.pool && !l.listingPool ? '<p class="fine warn">The listing does not mention a pool, but the aerial view shows one.</p>' : ''}` });
  }
  function energyCard(l, d) {
    const e = d.energy, so = d.solar || {}, a = d.aerial || {}, s = d.scores?.energy;
    if (!e) return '';
    const sun = ctx.buyer?.sunControl?.(l, d) || '';
    return card('energy', { icon: 'zap', title: 'Energy and solar', est: true, score: s?.score, reason: s?.reason, src: ['energy', 'solar', 'aerial'],
      headline: `Electric bill about <b data-count="${e.billMonth}" data-prefix="$">$0</b> a month`,
      body: `<ul class="rows">${row('zap', 'Estimated use', `${e.kwhYear.toLocaleString('en-US')} kWh a year`)}${row('activity', `Price (${esc(e.priceMonth || '')})`, `${e.priceCents}¢ per kWh`)}
        ${so.panels ? row('sun', 'Solar potential', `${so.panels} panels · covers ${so.coverPct}% of the estimated bill`) + `<li class="wide">${bar(so.coverPct, '#ffe14d')}</li>` + row('piggy-bank', so.existing ? 'A system this size would be worth' : 'Solar could save', `${usd(so.savingsYear)} a year`) : row('sun', 'Solar potential', esc(so.why || 'Not available'))}
        ${so.existing || a.solar ? row('check', 'Solar panels', 'Already on the roof') : ''}
        ${row('house', 'Roof', `${esc(a.roofMaterial || 'Unknown')}${a.roofCondition ? ` · condition ${a.roofCondition} of 5` : ''}`)}</ul>${sun}` });
  }
  function riskCard(l, d) {
    const r = d.risk || {}, n = r.nri, s = d.scores?.risk;
    if (!n && !r.flood) return '';
    const hz = { Wildfire: 'flame', Earthquake: 'activity', Hurricane: 'waves', Tornado: 'activity', 'Heat wave': 'thermometer', 'Inland flooding': 'droplets', 'Coastal flooding': 'waves' };
    return card('risk', { icon: 'shield', title: 'Risk and insurance', score: s?.score, reason: s?.reason, src: ['risk', 'insurance'],
      headline: n ? `Natural hazard risk here is <b>${esc((n.rating || '').toLowerCase())}</b> for the U.S.` : esc(r.flood.label),
      body: `${n ? `<div class="gauge" role="img" aria-label="Risk index ${n.score} of 100"><i style="left:${n.score}%"></i><span>Lower</span><span>Higher</span></div>` : ''}
        <ul class="rows">${(n?.top || []).map((h) => row(hz[h.hazard] || 'triangle-alert', esc(h.hazard), esc(h.rating || ''))).join('')}
        ${r.flood ? row('droplets', 'Flood map', esc(r.flood.label)) : row('droplets', 'Flood map', NA)}</ul>
        ${r.flood?.note ? `<p class="fine warn">${icon('triangle-alert', 13)} ${esc(r.flood.note)}</p>` : ''}
        ${r.insurancePressure ? `<p class="versus">${icon('shield', 15)}${esc(r.insurancePressure)} <em class="est">Estimate</em></p>` : ''}<p class="fine">Not insurance advice. Ask an insurer for a quote.</p>` });
  }
  function activityCard(l, d) {
    const a = d.activity || {}, s = d.scores?.activity;
    if (!(a.facts || []).length) return '';
    return card('activity', { icon: 'store', title: 'Neighborhood activity', score: s?.score, reason: s?.reason, headline: esc(a.facts[0]),
      body: `<ul class="rows">${a.facts.slice(1).map((f) => row('building-2', esc(f), '')).join('')}</ul>${(a.employers || []).length ? `<p class="sub2">Largest employers nearby</p><ul class="chips">${a.employers.map((e) => `<li>${esc(e.name)} <small>${e.employees} staff</small></li>`).join('')}</ul>` : ''}` });
  }
  function schoolsCard(l, d) {
    const near = d.places?.school || [], named = d.home?.schools || [];
    if (!near.length && !named.length) return '';
    return card('schools', { icon: 'graduation-cap', title: 'Schools nearby', noRing: true, src: ['places', 'home'], headline: near[0] ? `${esc(near[0].name)} is <b>${dist(near[0].distM)}</b> away` : 'Schools named in the listing',
      body: `<ul class="rows">${near.map((p) => row('school', esc(p.name), `${dist(p.distM)} · ${p.walkMin <= 15 ? p.walkMin + ' min walk' : p.driveMin + ' min drive'}`)).join('')}</ul>
        ${named.length ? `<p class="sub2">Named in the listing</p><ul class="chips">${named.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}<p class="fine">Distances only. No ratings: the listing data has none.</p>` });
  }
  function hoaCard(l, d) {
    const h = d.home || {}, a = d.apartment;
    const included = (h.hoa?.lines || []).map((x) => /include/i.test(x) ? x.replace(/^.*?include[s]?\s*/i, '').split(/,\s*/) : []).flat().filter(Boolean);
    const amen = a ? a.amenities || [] : h.community || [];
    if (!h.hoa && !amen.length) return '';
    const AM = [[/pool|spa/i, 'waves'], [/fitness|gym/i, 'dumbbell'], [/gate|security|access|concierge/i, 'shield'], [/park|garden|green|deck|fire pit/i, 'trees'], [/parking|garage|valet/i, 'car'], [/water|sewer|trash|utilit/i, 'droplets'], [/pet/i, 'heart'], [/elevator/i, 'building-2']];
    const chip = (t) => `<li>${icon((AM.find(([re]) => re.test(t)) || [0, 'check'])[1], 13)}${esc(t)}</li>`;
    return card('hoa', { icon: 'landmark', title: a ? "What's included" : 'HOA and community', noRing: true, src: ['home'],
      headline: h.hoa?.fee ? `HOA fee <b>${usd(h.hoa.fee)}</b> a month${h.hoa.name ? ` <small>${esc(h.hoa.name)}</small>` : ''}` : a ? 'Community amenities' : 'No HOA fee listed',
      body: `${included.length ? `<p class="sub2">The fee covers</p><ul class="chips ic">${included.map(chip).join('')}</ul>` : h.hoa?.fee ? '<p class="fine">The listing does not say what the fee covers.</p>' : ''}
        ${amen.length ? `<p class="sub2">${a ? 'Amenities' : 'Community'}</p><ul class="chips ic">${amen.slice(0, 12).map(chip).join('')}</ul>` : ''}
        ${[...(h.parking || []).slice(0, 2), ...(h.utilities || []).slice(0, 2)].length ? `<p class="sub2">Home</p><ul class="chips">${[...(h.parking || []).slice(0, 2), ...(h.utilities || []).slice(0, 2), ...(h.eco || []).slice(0, 2)].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}` });
  }
  function incomeCard(l, d) {
    const c = d.census;
    if (!c || !c.income) return '';
    const max = Math.max(c.income, c.city?.income || 0) * 1.15, yr = (ctx.insights.source('census')?.date || '').split('-').pop();
    return card('income', { icon: 'landmark', title: 'Area facts', noRing: true, src: ['census'], headline: `Median household income <b>${usd(c.income)}</b> <small>(Census${yr ? ', ' + esc(yr) : ''})</small>`,
      body: `<div class="vs"><span>This area</span>${bar((100 * c.income) / max, '#b8c4d6')}<b>${usd(c.income)}</b></div>${c.city?.income ? `<div class="vs"><span>City median</span>${bar((100 * c.city.income) / max, '#6b7688')}<b>${usd(c.city.income)}</b></div>` : ''}
        <ul class="rows">${c.grossRent ? row('wallet', 'Median rent', `${usd(c.grossRent)}${c.city?.grossRent ? ` <small>city ${usd(c.city.grossRent)}</small>` : ''}`) : ''}${c.homeValue ? row('house', 'Median home value', `${money(c.homeValue)}${c.city?.homeValue ? ` <small>city ${money(c.city.homeValue)}</small>` : ''}`) : ''}
        ${c.ownerShare != null ? row('key-round', 'Homes owned by their occupant', c.ownerShare + '%') : ''}${c.medianYearBuilt ? row('clock', 'Typical home built', String(c.medianYearBuilt)) : ''}</ul>` });
  }
  function noiseCard(l, d) {
    const n = d.noise;
    if (!n || (!n.highway && !n.rail && !n.airport)) return '';
    return card('noise', { icon: 'volume-2', title: 'Street noise check', noRing: true, headline: n.highway ? `Highway ${esc(n.highway.name || '')} is <b>${dist(n.highway.distM)}</b> away` : 'Distances to noise sources',
      body: `<ul class="rows">${n.highway ? row('car', `Highway ${esc(n.highway.name || '')}`, dist(n.highway.distM)) : ''}${n.rail ? row('train-front', esc(n.rail.name || 'Rail line'), dist(n.rail.distM)) : ''}${n.airport ? row('plane', esc(n.airport.name || 'Airport'), dist(n.airport.distM)) : ''}</ul><p class="fine">Distances only: the game does not measure sound.</p>` });
  }

  function render() {
    const l = cur, d = ins;
    const saved = ctx.saved.has(l.id), canTour = (l.matterportIds || []).length > 0;
    const photo = ctx.hud.photoSources(l)[0];
    const mission = ctx.clients?.active;
    el.innerHTML = `
      <div class="ihead">${photo ? `<img referrerpolicy="no-referrer" src="${esc(photo)}" alt="" onerror="this.remove()"/>` : ''}
        <button class="iclose" aria-label="Close insights"><kbd>Esc</kbd></button>
        <div class="ititle"><span class="kind" style="--k:${KIND_COLOR[l.kind]}">${esc(l.status || KIND_LABEL[l.kind])}</span>
          <div class="price">${esc(priceText(l))}${d?.facts?.askingOnly ? '<small>last asking price</small>' : l.kind === 'sold' ? `<small>${esc(l.priceLabel || '')}</small>` : ''}</div>
          <div class="facts">${esc(factsText(l))}</div><div class="addr">${l.name ? `<b>${esc(l.name)}</b> · ` : ''}${esc(l.address)}${l.city ? ', ' + esc(l.city) : ''}</div></div></div>
      <div class="icards">${d ? [valueCard, costCard, rentCard, errandsCard, outdoorsCard, energyCard, riskCard, activityCard, schoolsCard, hoaCard, incomeCard, noiseCard].map((f) => { try { return f(l, d); } catch (e) { console.warn('[panel]', f.name, e); return ''; } }).join('') : '<section class="icard"><p class="headline">Insights are not available for this home yet.</p><p class="fine">Run tools/enrich_city.py to build them.</p></section>'}
        ${d?.mock ? '<p class="fine center">Synthetic demo data: not a real place.</p>' : ''}</div>
      <div class="iactions">
        ${mission ? `<button class="act primary" data-act="submit">${icon('send', 16)}Submit this home</button>` : ''}
        <button class="act${canTour ? '' : ' off'}" data-act="tour" ${canTour ? '' : 'disabled'}><kbd>E</kbd>${canTour ? 'Walk inside' : 'No 3D tour'}</button>
        <button class="act" data-act="save"><kbd>F</kbd>${saved ? 'Saved' : 'Save'}</button>
        <button class="act" data-act="maya"><kbd>V</kbd>Ask Maya</button>
        <button class="act" data-act="compare"><kbd>Tab</kbd>Compare</button>
        <button class="act" data-act="better"><kbd>B</kbd>Better options</button>
        <button class="act ghost" data-act="replay" title="Play the reveal again">${icon('sparkles', 15)}Replay</button>
        <p class="keys"><kbd>,</kbd><kbd>.</kbd> other homes · <kbd>H</kbd> sources · <kbd>[</kbd><kbd>]</kbd> down payment${d?.solar?.panels ? ' · <kbd>Y</kbd> solar' : ''}${mission ? ' · <kbd>Enter</kbd> submit' : ''}</p>
      </div>`;
    for (const k of openInfo) toggleInfo(k, true);
    wire();
  }
  function toggleInfo(key, on) {
    const sec = el.querySelector(`[data-card="${key}"]`);
    if (!sec) return;
    const box = sec.querySelector('.isrc'), btn = sec.querySelector('.ibtn');
    const show = on ?? box.hidden;
    box.hidden = !show; btn.setAttribute('aria-expanded', String(show)); btn.classList.toggle('on', show);
    if (show) openInfo.add(key); else openInfo.delete(key);
  }
  function wire() {
    el.querySelector('.iclose').addEventListener('click', () => ctx.reveal.close());
    for (const b of el.querySelectorAll('.ibtn')) b.addEventListener('click', () => { toggleInfo(b.dataset.info); ctx.audio.blip(900, 0.04, 'sine', 0.08); });
    const acts = { tour: 'KeyE', save: 'KeyF', maya: 'KeyV', compare: 'Tab', better: 'KeyB' };
    for (const b of el.querySelectorAll('.act')) b.addEventListener('click', () => {
      b.blur();
      const a = b.dataset.act;
      if (a === 'replay') ctx.reveal.replay();
      else if (a === 'submit') ctx.clients?.submit(cur);
      else if (a === 'maya') ctx.maya?.open(true);
      else ctx.emit('key', acts[a], null);
    });
    wireCost();
    ctx.buyer?.wirePanel?.(el, cur, ins);
  }
  function wireCost() {
    for (const b of el.querySelectorAll('[data-down]')) b.addEventListener('click', () => setDown(Number(b.dataset.down)));
    el.querySelector('[data-solar]')?.addEventListener('change', (e) => { opts.solarOn = e.target.checked; refreshCost(); });
  }
  function refreshCost() {
    const box = el.querySelector('.costbody');
    if (!box || !ins?.cost) return;
    box.innerHTML = costBody(cur, ins);
    countUp(box, 350);
    wireCost();
    ctx.audio.blip(700, 0.05, 'sine', 0.08);
    ctx.emit('cost-options', opts);
  }

  // numbers count up and rings fill when a card arrives
  function countUp(root, ms = 900) {
    const reduce = ctx.settings?.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const n of root.querySelectorAll('[data-count]')) {
      const to = Number(n.dataset.count), pre = n.dataset.prefix || '';
      if (reduce) { n.textContent = pre + to.toLocaleString('en-US'); continue; }
      const t0 = performance.now();
      const tick = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3; n.textContent = pre + Math.round(to * e).toLocaleString('en-US'); if (k < 1 && n.isConnected) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    for (const c of root.querySelectorAll('.ring .fg')) requestAnimationFrame(() => { c.style.strokeDashoffset = c.dataset.to; });
  }
  function animateIn(instant) {
    const cards = [...el.querySelectorAll('.icard')];
    cards.forEach((c, i) => {
      const slow = (ctx.params.get('pace') || ctx.settings?.revealPace || 'guided') !== 'quick';
      const delay = instant ? 0 : slow ? 250 + i * 480 : 140 + i * 110;
      c.style.setProperty('--d', delay + 'ms');
      setTimeout(() => { if (c.isConnected) { c.classList.add('in'); countUp(c); } }, delay);
    });
  }

  // keyboard: , and . step through the homes, H shows every source, [ and ] change the down
  // payment, Y switches solar, Enter submits to the client
  ctx.on('key', (code) => {
    if (ctx.state !== 'play' || ctx.hud.choosing) return;
    if (code === 'Comma' || code === 'Period') {
      const list = ctx.world.listings.filter((l) => ctx.listingsSys.visible[l.kind]);
      if (!list.length) return;
      const i = cur ? list.indexOf(cur) : -1;
      ctx.reveal.select(list[(i + (code === 'Period' ? 1 : list.length - 1) + (i < 0 && code === 'Comma' ? 1 : 0)) % list.length], { instant: !!cur });
      return;
    }
    if (!cur || !el.classList.contains('show')) return;
    if (code === 'KeyH') { const any = openInfo.size > 0; for (const b of el.querySelectorAll('.ibtn')) toggleInfo(b.dataset.info, !any); }
    else if ((code === 'BracketLeft' || code === 'BracketRight') && ins?.cost) { const steps = [3.5, 10, 20], i = Math.max(0, steps.indexOf(opts.downPct)); setDown(steps[Math.max(0, Math.min(2, i + (code === 'BracketRight' ? 1 : -1)))]); }
    else if (code === 'KeyY' && ins?.solar?.panels && !ins.solar.existing) { opts.solarOn = !opts.solarOn; refreshCost(); }
    else if (code === 'Enter' && ctx.clients?.active && !ctx.clients.active.game) ctx.clients.submit(cur);
  });

  ctx.on('select', (l) => {
    if (!l) { cur = null; ins = null; el.classList.remove('show'); document.body.classList.remove('revealing'); return; }
    cur = l; ins = null; openInfo = new Set();
    document.body.classList.add('revealing');
  });
  // narrated: Maya is telling the home's story, so the panel opens with no cards and she brings
  // them in one at a time (focus), then the rest together (revealAll)
  ctx.on('reveal-panel', (l, d, o = {}) => {
    if (l !== cur) return;
    ins = d;
    opts.solarOn = false;
    render();
    el.scrollTop = 0;
    el.querySelector('.icards').scrollTop = 0;
    el.classList.add('show');
    el.classList.toggle('told', !!o.narrated);
    if (o.narrated) for (const c of el.querySelectorAll('.icard[data-card]')) c.classList.add('wait');
    else animateIn(ctx.reveal.stage >= 3);
    ctx.audio.whoosh?.(0.5);
    window.__gpa.panel = { id: l.id, cards: [...el.querySelectorAll('.icard')].map((c) => c.dataset.card).filter(Boolean), narrated: !!o.narrated };
  });
  function arrive(c, delay = 0) {
    c.classList.remove('wait');
    void c.offsetWidth; // so it slides in rather than just appearing
    setTimeout(() => { if (c.isConnected && !c.classList.contains('in')) { c.classList.add('in'); countUp(c); } }, delay);
  }
  ctx.on('saved', () => { if (cur && el.classList.contains('show')) { const b = el.querySelector('[data-act="save"]'); if (b) b.innerHTML = `<kbd>F</kbd>${ctx.saved.has(cur.id) ? 'Saved' : 'Save'}`; } });
  ctx.on('tour-enter', () => el.classList.add('away'));
  ctx.on('tour-exit', () => el.classList.remove('away'));

  return {
    el,
    get options() { return opts; },
    setOptions(o) { Object.assign(opts, o); refreshCost(); },
    refresh() { if (cur && ins && el.classList.contains('show')) { render(); for (const c of el.querySelectorAll('.icard')) c.classList.add('in'); countUp(el, 1); } },
    // the card she is talking about comes in (or lights up again) and scrolls into view
    focus(key) {
      const sec = el.querySelector(`[data-card="${key}"]`);
      if (!sec) return false;
      for (const c of el.querySelectorAll('.icard.now')) if (c !== sec) c.classList.remove('now');
      if (sec.classList.contains('wait') || !sec.classList.contains('in')) arrive(sec, 30);
      sec.classList.add('now');
      setTimeout(() => { if (sec.isConnected) sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60);
      return true;
    },
    // the story is over or skipped: every card she did not get to comes in
    revealAll() {
      el.classList.remove('told');
      for (const c of el.querySelectorAll('.icard.now')) c.classList.remove('now');
      const rest = [...el.querySelectorAll('.icard:not(.in)')];
      rest.forEach((c, i) => arrive(c, 40 + i * 110));
      // show where the new cards start
      if (rest[0]) setTimeout(() => { if (rest[0].isConnected) rest[0].scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 120);
      if (window.__gpa.panel) window.__gpa.panel.narrated = false;
    },
    flash(key) {
      const sec = el.querySelector(`[data-card="${key}"]`);
      if (!sec) return false;
      sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
      sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
      return true;
    },
    cards: () => [...el.querySelectorAll('.icard')].map((c) => c.dataset.card),
  };
}
