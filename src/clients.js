// Client missions: real buyer and renter situations that make the player use every kind of
// data. The numbers in each brief are generated from this city's own insight data, so every
// mission shown is solvable. Inbox on I, or ask Maya. Accepting a mission softly highlights
// candidate homes (not the answer); the player explores, then submits a home from its panel.
// (The older src/missions.js is the voice search and GPS guide; this file is the client work.)
import { icon } from './icons.js';
import { money } from './format.js';
import { confetti } from './confetti.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (arr, p) => { const a = arr.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))] : null; };
const LEVELS = [[0, 'Rookie Agent'], [300, 'Junior Agent'], [700, 'Agent'], [1200, 'Senior Agent'], [1800, 'Broker'], [2500, 'Top Producer']];
const BADGES = { solar: ['Solar Scout', 'sun'], comps: ['Comp Master', 'scale'], rent: ['Rent Whisperer', 'wallet'], risk: ['Risk Reader', 'shield'], street: ['Street Smart', 'store'], pool: ['Pool Spotter', 'waves'], commute: ['Commute Planner', 'route'], rush: ['Open House Pro', 'clock'] };
const FOR_SALE = (r) => r.kind === 'sale' && r.cost;
const RENTAL = (r) => (r.kind === 'apartments' || r.kind === 'rent') && r.rent;

// Each builder gets every index row for the city and returns a mission, or null when this
// city's data cannot support it. req: [label, test(row)]. metric: lower is better.
const BUILD = [
  (R) => {
    const pool = R.filter((r) => FOR_SALE(r) && (r.beds ?? 0) >= 2);
    if (pool.length < 2) return null;
    const budget = Math.ceil(pct(pool.map((r) => r.price), 0.6) / 5000) * 5000, sup = Math.max(2, pct(pool.map((r) => r.superDrive), 0.6));
    const ok = pool.filter((r) => r.price <= budget && r.superDrive <= sup);
    const target = Math.ceil(pct(ok.map((r) => r.cost), 0.5) / 50) * 50;
    return { id: '1', title: 'First Home', icon: 'house', badge: null, pool: FOR_SALE, client: 'Dana', who: 'First time buyer',
      story: `I've saved for years and I'm finally buying. I cook every night, so groceries need to be close, and the monthly cost can't sink me.`,
      req: [[`Asking price ${money(budget)} or less`, (r) => r.price <= budget], ['2 or more bedrooms', (r) => (r.beds ?? 0) >= 2], [`Supermarket within a ${sup} minute drive`, (r) => r.superDrive != null && r.superDrive <= sup]],
      goal: `Lowest monthly cost. Under ${usd(target)} a month earns the third star.`, metric: (r) => r.cost, threshold: (r) => r.cost <= target, uses: 'Listings, monthly cost, places' };
  },
  (R) => {
    const pool = R.filter((r) => FOR_SALE(r) && (r.beds ?? 0) >= 3 && r.lotAcres);
    if (pool.length < 2) return null;
    const lot = Math.max(0.01, Math.floor(pct(pool.map((r) => r.lotAcres), 0.5) * 100) / 100);
    return { id: '2', title: 'Room to Grow', icon: 'trees', badge: null, pool: FOR_SALE, client: 'Sam', who: 'Moving up from a one bedroom',
      story: `I need three bedrooms and some ground of my own. And I walk every morning, so a park close by matters to me.`,
      req: [['3 or more bedrooms', (r) => (r.beds ?? 0) >= 3], ['A park within a 10 minute walk', (r) => r.parkWalk != null && r.parkWalk <= 10], [`Lot of ${lot} acres or more`, (r) => (r.lotAcres || 0) >= lot]],
      goal: 'The biggest lot that meets everything earns the third star.', metric: (r) => -(r.lotAcres || 0), uses: 'Listings, lot size, parks' };
  },
  (R) => {
    const pool = R.filter((r) => FOR_SALE(r) && r.bill);
    if (pool.length < 2) return null;
    const budget = Math.ceil(pct(pool.map((r) => r.price), 0.75) / 5000) * 5000;
    const net = (r) => r.bill - (r.solarSave || 0) / 12;
    return { id: '3', title: 'Power Bill Hater', icon: 'zap', badge: 'solar', pool: FOR_SALE, client: 'Priya', who: 'Engineer, hates waste',
      story: `My last summer electric bill made me cry. Find me the home with the lowest power bill, counting what rooftop solar could save.`,
      req: [[`Asking price ${money(budget)} or less`, (r) => r.price <= budget], ['Has an electric bill estimate', (r) => r.bill != null]],
      goal: 'Lowest electric bill after solar savings earns the third star.', metric: net, uses: 'Electricity prices, solar estimate, roof and tree cover from the air' };
  },
  (R) => {
    const homes = R.filter(FOR_SALE), rents = R.filter(RENTAL);
    if (!homes.length || !rents.length) return null;
    const rent = Math.round(pct(homes.map((r) => r.rentNearby).filter(Boolean), 0.5) / 50) * 50 || Math.round(pct(rents.map((r) => r.rent), 0.5) / 50) * 50;
    const near = homes.filter((r) => Math.abs(r.cost - rent) / rent <= 0.1);
    if (near.length) return { id: '4', title: 'Rent or Buy?', icon: 'wallet', badge: 'rent', pool: FOR_SALE, client: 'Marcus', who: `Pays ${usd(rent)} a month in rent`,
      story: `I pay ${usd(rent)} in rent and I'm tired of it. Is there a home I could own for about the same each month?`,
      req: [[`True monthly cost within 10% of ${usd(rent)}`, (r) => r.cost && Math.abs(r.cost - rent) / rent <= 0.1]],
      goal: 'The closest monthly cost to his rent earns the third star.', metric: (r) => Math.abs(r.cost - rent), uses: 'Apartment rents against home listings, monthly cost' };
    const cheapest = Math.min(...homes.map((r) => r.cost));
    return { id: '4', title: 'Rent or Buy?', icon: 'wallet', badge: 'rent', pool: RENTAL, client: 'Marcus', who: `Pays ${usd(rent)} a month in rent`,
      story: `I pay ${usd(rent)} in rent. Could I own for about the same? If not, prove it: show me a rental that costs less than the cheapest home here costs to own.`,
      req: [[`Rent below ${usd(cheapest)}, the cheapest home's monthly cost here`, (r) => r.rent && r.rent < cheapest], [`Rent no more than ${usd(rent)}`, (r) => r.rent <= rent]],
      goal: 'No home here comes within 10% of his rent. The lowest rent earns the third star.', metric: (r) => r.rent, uses: 'Apartment rents against home listings, monthly cost' };
  },
  (R) => {
    const pool = R.filter((r) => (FOR_SALE(r) || RENTAL(r)) && r.downtownMin != null);
    if (pool.length < 3) return null;
    const d = pct(pool.map((r) => r.downtownMin), 0.4), t = Math.max(2, pct(pool.map((r) => r.transitWalk), 0.4));
    return { id: '5', title: 'Downtown Commuter', icon: 'route', badge: 'commute', pool: (r) => FOR_SALE(r) || RENTAL(r), client: 'Elena', who: 'Works downtown, no patience for traffic',
      story: `I'm downtown five days a week. Some days I drive, some days I take transit. Keep both short.`,
      req: [[`${d} minutes or less to downtown by car`, (r) => r.downtownMin <= d], [`Transit stop within a ${t} minute walk`, (r) => r.transitWalk != null && r.transitWalk <= t]],
      goal: 'The shortest drive plus walk earns the third star.', metric: (r) => r.downtownMin + (r.transitWalk ?? 30), uses: 'Drive time estimates, transit stops' };
  },
  (R) => {
    const pool = R.filter((r) => (FOR_SALE(r) || RENTAL(r)) && r.pool);
    if (!pool.length) return null;
    const cost = (r) => r.cost ?? r.rent;
    return { id: '6', title: 'Pool Season', icon: 'waves', badge: 'pool', pool: (r) => FOR_SALE(r) || RENTAL(r), client: 'Jo', who: 'Swims every day',
      story: `Listings say "pool" and then it's a puddle, or there's no pool at all. I want one you can actually see from the air.`,
      req: [['A pool seen from the air', (r) => r.pool]],
      goal: 'The lowest monthly cost or rent with a real pool earns the third star.', metric: cost, uses: 'Aerial pool detection against listing text' };
  },
  (R) => {
    const pool = R.filter((r) => (FOR_SALE(r) || RENTAL(r)) && r.riskScore != null);
    if (pool.length < 3) return null;
    const safeZone = pool.filter((r) => !r.sfha);
    const tiers = ['lower', 'about average', 'higher'], best = tiers.find((t) => safeZone.some((r) => r.riskTier === t));
    const roof = Math.min(4, Math.max(3, pct(safeZone.filter((r) => r.riskTier === best).map((r) => r.roof), 0.5) || 3));
    return { id: '7', title: 'Low Risk', icon: 'shield', badge: 'risk', pool: (r) => FOR_SALE(r) || RENTAL(r), client: 'Walt', who: 'Retired insurance adjuster',
      story: `Thirty years of claims taught me what water and wind do to a house. Keep me out of the flood zone and under a solid roof.`,
      req: [['Outside the high risk flood zone', (r) => !r.sfha], [`Hazard pressure "${best}" for the state, the best here`, (r) => r.riskTier === best], [`Roof condition ${roof} of 5 or better from the air`, (r) => (r.roof || 0) >= roof]],
      goal: 'The lowest FEMA risk score earns the third star.', metric: (r) => r.riskScore, uses: 'FEMA risk index, FEMA flood map, roof condition from the air' };
  },
  (R) => {
    const pool = R.filter((r) => FOR_SALE(r) && r.rentNearby);
    if (pool.length < 2) return null;
    const ratio = (r) => r.rentNearby / r.cost;
    const best = Math.max(...pool.map(ratio)), need = Math.floor(best * 20) / 20 - 0.05;
    return { id: '8', title: 'Investor', icon: 'building-2', badge: 'rent', pool: FOR_SALE, client: 'Ines', who: 'Buying a first rental',
      story: `I want a home I can rent out. Show me where nearby rents come closest to covering what it costs to own.`,
      req: [[`Nearby rent covers at least ${Math.round(need * 100)}% of the monthly cost`, (r) => r.rentNearby && ratio(r) >= need]],
      goal: 'The best rent to cost ratio earns the third star.', metric: (r) => -ratio(r), uses: 'Apartment rents, sale listings, monthly cost' };
  },
  (R) => {
    const pool = R.filter((r) => (FOR_SALE(r) || RENTAL(r)) && r.shopsWalk != null);
    if (pool.length < 3) return null;
    const n = pct(pool.map((r) => r.shopsWalk), 0.7);
    return { id: '9', title: 'Busy Street Life', icon: 'store', badge: 'street', pool: (r) => FOR_SALE(r) || RENTAL(r), client: 'Theo', who: 'Chef, never home before midnight',
      story: `I want to walk out the door into restaurants, coffee and late night food. A car should be optional.`,
      req: [[`${n} or more shops and places to eat within a 10 minute walk`, (r) => r.shopsWalk >= n]],
      goal: 'The most shops and places to eat on foot earns the third star.', metric: (r) => -r.shopsWalk, uses: 'Commercial tenants and OpenStreetMap places' };
  },
  (R) => {
    const pool = R.filter((r) => r.ppsf && r.lowerThanPct != null);
    if (pool.length < 2) return null;
    const pick = pool[Math.floor(pool.length / 2)];
    return { id: '10', title: 'Price Detective', icon: 'scale', badge: 'comps', game: 'guess', target: pick.id, client: 'The office', who: 'A quick test of your eye',
      story: `Look at one home's photos and facts, then guess its price per square foot. The nearby homes will show how close you were.`,
      req: [], goal: 'Within 5% earns three stars, within 12% two, within 25% one.', uses: 'Sale comps' };
  },
  (R) => {
    const tour = (r) => r.tour && (FOR_SALE(r) || RENTAL(r) || r.kind === 'sold');
    const pool = R.filter(tour);
    if (pool.length < 3) return null;
    const beds = pct(pool.map((r) => r.beds).filter((b) => b != null), 0.4) ?? 0;
    const ok = (r) => tour(r) && (r.beds == null || r.beds >= beds);
    if (R.filter(ok).length < 3) return null;
    return { id: '11', title: 'Open House Rush', icon: 'clock', badge: 'rush', pool: ok, game: 'rush', timer: 300, client: 'Bea', who: 'In town for one afternoon',
      story: `I fly out tonight. Walk me through three homes${beds ? ` with ${beds} or more bedrooms` : ''} before the clock runs out.`,
      req: [[beds ? `${beds} or more bedrooms (or an apartment community)` : 'Any home with a 3D tour', ok]],
      goal: 'Walk inside 3 matching homes within 5 minutes. Three homes earn three stars.', uses: '3D tours, listings' };
  },
];

export function initClients(ctx) {
  const inbox = document.createElement('div');
  inbox.id = 'inbox';
  const tracker = document.createElement('div');
  tracker.id = 'tracker';
  const result = document.createElement('div');
  result.id = 'cresult';
  document.body.append(inbox, result);
  ctx.hud.root.append(tracker);
  let missions = [], active = null, startedAt = 0, visited = new Set(), open = false, tick = 0, shownAt = 0;
  let save = { xp: 0, best: {}, badges: [], runs: [] };
  try { save = { ...save, ...JSON.parse(localStorage.getItem('gpa-career') || '{}') }; } catch { /* first run or private mode */ }
  const persist = () => { try { localStorage.setItem('gpa-career', JSON.stringify(save)); } catch { /* private mode */ } };
  const level = () => { let i = 0; LEVELS.forEach(([xp], k) => { if (save.xp >= xp) i = k; }); return { name: LEVELS[i][1], next: LEVELS[i + 1] || null, from: LEVELS[i][0] }; };
  const key = (m) => `${ctx.city}:${m.id}`;
  const rows = () => ctx.insights.rows().map((r) => ({ ...r, tour: (ctx.listingsSys.byId(r.id)?.matterportIds || []).length > 0 }));
  const rowOf = (l) => rows().find((r) => r.id === String(l.id));

  function build() {
    const R = rows();
    missions = BUILD.map((f) => { try { return f(R); } catch (e) { console.warn('[clients]', e); return null; } }).filter(Boolean);
    for (const m of missions) {
      if (m.game) continue;
      const ok = R.filter((r) => m.pool(r) && m.req.every(([, t]) => t(r)));
      m.solvable = ok.length > 0;
      m.bestId = ok.sort((a, b) => m.metric(a) - m.metric(b))[0]?.id || null;
    }
    missions = missions.filter((m) => m.game || m.solvable);
  }

  // stars for a submitted home: 0 to 3
  function grade(m, r) {
    const checks = m.req.map(([label, t]) => ({ label, ok: !!(m.pool(r) && t(r)) }));
    const all = checks.every((c) => c.ok), some = checks.filter((c) => c.ok).length;
    let stars = all ? 2 : some >= Math.ceil(checks.length / 2) && some > 0 ? 1 : 0;
    const best = rows().find((x) => x.id === m.bestId);
    let top = false;
    if (all && best) { const a = m.metric(r), b = m.metric(best); top = r.id === best.id || Math.abs(a - b) <= Math.abs(b) * 0.03 + 1e-9; if (m.threshold) top = top || m.threshold(r); }
    if (all && top) stars = 3;
    return { stars, checks, top, best };
  }

  // ---- inbox (I)
  function renderInbox(detail) {
    const lv = level();
    const span = lv.next ? ((save.xp - lv.from) / (lv.next[0] - lv.from)) * 100 : 100;
    const m = detail ? missions.find((x) => x.id === detail) : null;
    inbox.innerHTML = `<div class="phone" role="dialog" aria-label="Client inbox">
      <header><div><b>Client inbox</b><span>${esc(lv.name)} · ${save.xp} XP${lv.next ? ` · ${lv.next[0] - save.xp} to ${esc(lv.next[1])}` : ''}</span><div class="xpbar"><i style="width:${span}%"></i></div></div><button class="x" aria-label="Close inbox"><kbd>I</kbd></button></header>
      ${m ? `<div class="mdetail"><button class="back">${icon('chevron-right', 14)}All clients</button>
          <div class="who"><span class="ava">${esc(m.client[0])}</span><div><b>${esc(m.client)}</b><small>${esc(m.who)}</small></div></div>
          <h2>${icon(m.icon, 20)}${esc(m.title)}</h2><p class="story">“${esc(m.story)}”</p>
          ${m.req.length ? `<p class="sub2">Needs</p><ul class="reqs">${m.req.map(([l]) => `<li>${icon('check', 14)}${esc(l)}</li>`).join('')}</ul>` : ''}
          <p class="goal">${icon('star', 14)}${esc(m.goal)}</p>${m.timer ? `<p class="goal">${icon('clock', 14)}${Math.round(m.timer / 60)} minutes on the clock</p>` : ''}
          <p class="fine">Uses: ${esc(m.uses)}</p>
          <button class="act primary accept" data-id="${m.id}">${active?.id === m.id ? 'Mission in progress' : 'Accept mission'}</button></div>`
        : `<ul class="mlist">${missions.map((x) => { const b = save.best[key(x)] || 0; return `<li><button data-id="${x.id}" class="${active?.id === x.id ? 'on' : ''}"><span class="ava">${icon(x.icon, 18)}</span><div><b>${esc(x.title)}</b><small>${esc(x.client)} · ${esc(x.who)}</small></div><span class="stars" aria-label="${b} of 3 stars">${[1, 2, 3].map((i) => `<i class="${i <= b ? 'on' : ''}">★</i>`).join('')}</span></button></li>`; }).join('')}</ul>
          <div class="badges2">${Object.entries(BADGES).map(([k, [name, ic]]) => `<span class="${save.badges.includes(k) ? 'on' : ''}" title="${esc(name)}">${icon(ic, 15)}${esc(name)}</span>`).join('')}</div>
          ${save.runs.length ? `<p class="sub2">Your best runs</p><ol class="board">${[...save.runs].sort((a, b) => b.stars - a.stars || a.s - b.s).slice(0, 5).map((r) => `<li><span>${esc(r.title)}</span><b>${'★'.repeat(r.stars)}</b><small>${Math.floor(r.s / 60)}:${String(r.s % 60).padStart(2, '0')}</small></li>`).join('')}</ol>` : ''}`}
    </div>`;
    inbox.querySelector('.x').addEventListener('click', close);
    inbox.querySelector('.back')?.addEventListener('click', () => renderInbox());
    for (const b of inbox.querySelectorAll('.mlist button')) b.addEventListener('click', () => { ctx.audio.blip(820, 0.05); renderInbox(b.dataset.id); });
    inbox.querySelector('.accept')?.addEventListener('click', (e) => { accept(e.target.dataset.id); });
  }
  function show(detail) { if (ctx.state !== 'play' || !missions.length) return false; open = true; ctx.state = 'inbox'; inbox.inert = false; renderInbox(detail); inbox.classList.add('show'); ctx.audio.whoosh?.(0.4); return true; }
  function close() { if (!open) return; open = false; if (inbox.contains(document.activeElement)) document.activeElement.blur(); inbox.inert = true; inbox.classList.remove('show'); if (ctx.state === 'inbox') ctx.state = 'play'; }

  // ---- an accepted mission
  function accept(id) {
    const m = missions.find((x) => x.id === String(id));
    if (!m) return false;
    close();
    active = m; startedAt = performance.now(); visited = new Set();
    ctx.audio.chime();
    if (m.game === 'guess') { playGuess(m); return true; }
    // soft highlight: every home that meets the first need, not just the answer
    const cands = rows().filter((r) => m.pool(r) && (m.req[0] ? m.req[0][1](r) : true)).map((r) => r.id);
    ctx.listingsSys.setHighlights(cands.length ? cands : null, null);
    ctx.hud.toast(`Mission accepted: ${m.title}`, 2600);
    ctx.maya?.say(`${m.client} needs your help. ${m.story}`, { caption: true });
    renderTracker();
    ctx.panel.refresh();
    ctx.emit('client-mission', m);
    pub();
    return true;
  }
  function abandon(quiet) {
    if (!active) return;
    active = null; tracker.classList.remove('show'); ctx.listingsSys.setHighlights(null, null);
    if (!quiet) ctx.hud.toast('Mission dropped');
    ctx.panel.refresh(); pub();
  }
  function renderTracker() {
    if (!active || active.game === 'guess') { tracker.classList.remove('show'); return; }
    const m = active, l = ctx.reveal.listing, r = l ? rowOf(l) : null;
    const left = m.timer ? Math.max(0, m.timer - (performance.now() - startedAt) / 1000) : null;
    tracker.innerHTML = `<div class="thead"><span class="ava">${esc(m.client[0])}</span><div><b>${esc(m.title)}</b><small>${esc(m.client)}${left != null ? ` · <span class="${left < 60 ? 'hot' : ''}">${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}</span>` : ''}</small></div><button class="drop" aria-label="Drop mission">${icon('x', 14)}</button></div>
      <ul>${m.req.map(([label, t]) => { const ok = r ? m.pool(r) && t(r) : null; return `<li class="${ok == null ? '' : ok ? 'ok' : 'no'}">${icon(ok == null ? 'chevron-right' : ok ? 'check' : 'x', 13)}<span>${esc(label)}</span></li>`; }).join('')}</ul>
      ${m.game === 'rush' ? `<p>${visited.size} of 3 homes walked${l && r && m.pool(r) && !visited.has(l.id) ? ' · this one counts: press E' : ''}</p>` : `<p>${l ? 'Checked against the selected home' : 'Select a home to check it'}</p>`}`;
    tracker.classList.add('show');
    tracker.querySelector('.drop').addEventListener('click', () => abandon());
  }

  function submit(l) {
    const m = active;
    if (!m || !l || m.game) return null;
    const r = rowOf(l);
    if (!r) return null;
    const g = grade(m, r);
    return finish(m, g.stars, { checks: g.checks, bestId: m.bestId, chosen: l, top: g.top });
  }
  function finish(m, stars, info) {
    const secs = Math.round((performance.now() - startedAt) / 1000);
    const prev = save.best[key(m)] || 0;
    const gained = Math.max(0, stars - prev) * 100 + (stars > 0 && !prev ? 50 : 0);
    const before = level().name;
    save.xp += gained;
    save.best[key(m)] = Math.max(prev, stars);
    let badge = null;
    if (m.badge && stars >= 2 && !save.badges.includes(m.badge)) { save.badges.push(m.badge); badge = BADGES[m.badge]; }
    if (stars > 0) save.runs.push({ title: m.title, city: ctx.city, stars, s: secs, at: new Date().toISOString().slice(0, 10) });
    save.runs = save.runs.slice(-40);
    persist();
    const after = level().name;
    active = null; tracker.classList.remove('show'); ctx.listingsSys.setHighlights(null, null); ctx.panel.refresh();
    const out = { id: m.id, stars, secs, gained, badge: badge?.[0] || null, levelUp: after !== before ? after : null, bestId: info.bestId || null, top: !!info.top };
    showResult(m, out, info);
    pub(out);
    ctx.emit('client-result', out);
    return out;
  }
  function showResult(m, out, info) {
    const best = info.bestId ? ctx.listingsSys.byId(info.bestId) : null;
    const bestRow = best ? rowOf(best) : null;
    const line = out.stars === 3 ? `${m.client} is thrilled.` : out.stars === 2 ? `${m.client} is happy. There was an even better fit.` : out.stars === 1 ? `${m.client} is not sure. Some needs were missed.` : `${m.client} passed on this one.`;
    result.innerHTML = `<div class="rcard" role="dialog" aria-label="Mission result"><p class="rtitle">${icon(m.icon, 18)}${esc(m.title)}</p>
      <div class="rstars" aria-label="${out.stars} of 3 stars">${[1, 2, 3].map((i) => `<i class="${i <= out.stars ? 'on' : ''}" style="--i:${i}">★</i>`).join('')}</div>
      <h2>${esc(line)}</h2>
      ${info.checks ? `<ul class="rchecks">${info.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'x', 15)}<span>${esc(c.label)}</span><em>${c.ok ? 'Fits' : 'Missed'}</em></li>`).join('')}</ul>` : ''}
      ${info.note ? `<p class="rnote">${info.note}</p>` : ''}
      ${best && (!info.chosen || info.chosen.id !== best.id) ? `<p class="rnote">Best possible answer: <b>${esc(best.price != null ? money(best.price) : bestRow?.rent ? usd(bestRow.rent) + ' a month' : '')}</b> ${best.beds != null ? '· ' + best.beds + ' bd' : ''} ${esc(best.name || best.address)}</p>` : best ? '<p class="rnote">You found the best possible answer.</p>' : ''}
      <p class="rxp">+${out.gained} XP${out.badge ? ` · Badge earned: <b>${esc(out.badge)}</b>` : ''}${out.levelUp ? ` · Promoted to <b>${esc(out.levelUp)}</b>` : ''}</p>
      <div class="ract">${best && (!info.chosen || info.chosen.id !== best.id) ? `<button class="act" data-a="fly">${icon('plane', 15)}Fly over the best answer</button>` : ''}<button class="act" data-a="inbox">${icon('inbox', 15)}Next client</button><button class="act primary" data-a="ok">Done <kbd>Enter</kbd></button></div></div>`;
    result.classList.add('show');
    ctx.state = 'result';
    shownAt = performance.now(); // the Enter that submitted must not also dismiss the result
    if (out.stars > 0) { ctx.audio.fanfare?.(); for (let i = 0; i < out.stars; i++) setTimeout(() => ctx.audio.star?.(i), 500 + i * 320); ctx.cam.shake?.(0.5); } else ctx.audio.blip(220, 0.3, 'triangle');
    // three stars: paper flies as the third one lands
    if (out.stars === 3) setTimeout(() => { if (result.classList.contains('show')) confetti(ctx); }, 1180);
    const done = (then) => { result.classList.remove('show'); if (ctx.state === 'result') ctx.state = 'play'; then?.(); };
    result.querySelector('[data-a="ok"]').addEventListener('click', () => done());
    result.querySelector('[data-a="inbox"]').addEventListener('click', () => done(() => show()));
    result.querySelector('[data-a="fly"]')?.addEventListener('click', () => done(() => ctx.reveal.select(best)));
    ctx.maya?.say(line, { caption: false });
  }

  // ---- Price Detective: guess the price per square foot
  async function playGuess(m) {
    const l = ctx.listingsSys.byId(m.target);
    const ins = await ctx.insights.get(m.target);
    if (!l || !ins?.value) { active = null; return; }
    const v = ins.value, lo = Math.round(Math.min(v.ppsf, ...v.comps.map((c) => c.ppsf)) * 0.6 / 10) * 10, hi = Math.round(Math.max(v.ppsf, ...v.comps.map((c) => c.ppsf)) * 1.5 / 10) * 10;
    await ctx.hud.interiorStills(l);
    const photos = ctx.hud.photoSources(l).slice(0, 3);
    result.innerHTML = `<div class="rcard guess" role="dialog" aria-label="Price Detective"><p class="rtitle">${icon('scale', 18)}Price Detective</p>
      <div class="gphotos">${photos.map((p) => `<img referrerpolicy="no-referrer" src="${esc(p)}" alt="" onerror="this.remove()"/>`).join('') || '<div class="ph"></div>'}</div>
      <h2>${l.beds ?? '?'} bed · ${l.baths ?? '?'} bath · ${Number(l.sqft).toLocaleString('en-US')} sq ft${l.yearBuilt ? ' · built ' + l.yearBuilt : ''}</h2>
      <p class="rnote">${esc((l.highlights || []).slice(0, 4).join(' · '))}</p>
      <label class="gslider"><span>Your guess: <b id="gval">${usd(Math.round((lo + hi) / 2))}</b> per square foot</span><input type="range" min="${lo}" max="${hi}" step="1" value="${Math.round((lo + hi) / 2)}" aria-label="Price per square foot"/><small><span>${usd(lo)}</span><span>${usd(hi)}</span></small></label>
      <div class="ract"><button class="act" data-a="cancel">Not now</button><button class="act primary" data-a="guess">Lock it in <kbd>Enter</kbd></button></div></div>`;
    result.classList.add('show'); ctx.state = 'result';
    const input = result.querySelector('input');
    input.addEventListener('input', () => { result.querySelector('#gval').textContent = usd(Number(input.value)); });
    input.focus();
    const lock = () => guess(Number(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lock(); } else if (e.key === 'Escape') result.querySelector('[data-a="cancel"]').click(); });
    result.querySelector('[data-a="guess"]').addEventListener('click', lock);
    result.querySelector('[data-a="cancel"]').addEventListener('click', () => { result.classList.remove('show'); ctx.state = 'play'; active = null; pub(); });
    pub();
  }
  async function guess(value) {
    const m = active;
    if (!m || m.game !== 'guess') return null;
    const ins = await ctx.insights.get(m.target);
    const real = ins.value.ppsf, err = Math.abs(value - real) / real;
    const stars = err <= 0.05 ? 3 : err <= 0.12 ? 2 : err <= 0.25 ? 1 : 0;
    const comps = ins.value.comps.slice(0, 4).map((c) => `${usd(c.ppsf)}`).join(', ');
    return finish(m, stars, { bestId: null, note: `You guessed <b>${usd(value)}</b>. It is listed at <b>${usd(real)}</b> per square foot (${usd(ins.facts.price)}), ${Math.round(err * 100)}% off. Nearby homes: ${comps} per square foot.` });
  }

  // ---- Open House Rush: walk inside 3 matching homes before the clock runs out
  ctx.on('tour-enter', (l) => {
    if (active?.game !== 'rush' || !l) return;
    const r = rowOf(l);
    if (r && active.pool(r) && !visited.has(l.id)) { visited.add(l.id); ctx.audio.star?.(visited.size - 1); ctx.hud.toast(`${visited.size} of 3 homes walked`); }
  });
  ctx.on('tour-exit', () => { if (active?.game === 'rush' && visited.size >= 3) finish(active, 3, { note: 'Three homes walked before the clock ran out.' }); else renderTracker(); });
  ctx.on('update', (dt) => {
    if (!active) return;
    tick += dt;
    if (tick < 0.5) return;
    tick = 0;
    if (active.timer && (performance.now() - startedAt) / 1000 >= active.timer && ctx.state === 'play') { const n = visited.size; finish(active, Math.min(3, n), { note: `Time. ${n} of 3 homes walked.` }); return; }
    if (active.timer) renderTracker();
  });
  ctx.on('select', () => renderTracker());
  ctx.on('insights-ready', () => { active = null; tracker.classList.remove('show'); build(); pub(); });
  ctx.on('city-unload', () => { active = null; tracker.classList.remove('show'); close(); });
  ctx.on('key', (code) => {
    if (code === 'KeyI') { if (open) close(); else if (ctx.state === 'play' && !ctx.hud.choosing) show(); } else if (code === 'Escape' && open) close();
    else if (open && (code === 'ArrowDown' || code === 'ArrowUp')) { const btns = [...inbox.querySelectorAll('.mlist button')]; if (btns.length) { const i = btns.indexOf(document.activeElement); btns[(i + (code === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length].focus(); } }
    else if (open && code === 'Enter') { const a = inbox.querySelector('.accept'); if (a) a.click(); else (inbox.querySelector('.mlist button:focus') || inbox.querySelector('.mlist button'))?.click(); }
    else if (open && code === 'Backspace') inbox.querySelector('.back')?.click();
    else if (code === 'Enter' && ctx.state === 'result' && performance.now() - shownAt > 300) (result.querySelector('[data-a="guess"]') || result.querySelector('[data-a="ok"]'))?.click();
    else if (code === 'Escape' && ctx.state === 'result') (result.querySelector('[data-a="cancel"]') || result.querySelector('[data-a="ok"]'))?.click();
  });

  function pub(last) {
    window.__gpa.clients = {
      list: () => missions.map((m) => ({ id: m.id, title: m.title, best: m.bestId || m.target, game: m.game || null })), active: active?.id || null, last: last || window.__gpa.clients?.last || null, xp: save.xp, level: level().name, badges: save.badges,
      accept: (id) => accept(id), best: (id) => missions.find((m) => m.id === String(id))?.bestId, submit: (id) => submit(ctx.listingsSys.byId(id)), guess: (v) => guess(v), visit: (id) => { visited.add(String(id)); if (visited.size >= 3) return finish(active, 3, {}); return null; },
      reset: () => { save = { xp: 0, best: {}, badges: [], runs: [] }; persist(); },
    };
  }
  pub();
  return {
    open: show, close, accept, submit, abandon,
    get active() { return active; },
    get missions() { return missions; },
    get career() { return { ...save, level: level().name }; },
    brief: () => (active ? `${active.title} for ${active.client}: ${active.req.map(([l]) => l).join('; ')}. ${active.goal}` : ''),
    check: (l) => { const r = active && l ? rowOf(l) : null; return r && !active.game ? grade(active, r) : null; },
  };
}
