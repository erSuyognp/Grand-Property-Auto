// What Maya says while the map opens up around a home, as one continuous walkthrough.
//
// buildScript() looks at the home (for sale, sold or for rent; how much of daily life is a
// walk; how its price compares), picks one of the hundred scripts in src/revealScripts.js that
// fits and has not been used lately, and fills it in with the home's own numbers. The result is
// a list of steps, one per thing the map or the panel shows:
//   home, walk (the rings), places (all the nearby places in one or two sentences), roof,
//   card_value, card_cost, card_insurance, card_energy, card_hoa / card_amenities, card_rent,
//   rest (the other cards)
// Each step carries
//   stock      the script's line for it (what she says when the model is off or slow)
//   card       the panel card it opens and lights (panel steps only)
//   must, max  what a line reworded by the model has to keep (src/lines.js)
//   order      for the places step: the order the place pins appear in, matching the line
// Nothing here talks about flood zones or FEMA ratings: insurance is said as the state average.
import { pick } from './lines.js';
import { PLACE_LABEL } from './icons.js';
import { SCRIPTS, POOLS } from './revealScripts.js';

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const an = (n) => (/^(8|11|18|8\d)$/.test(String(n)) ? 'an' : 'a');
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const PLACES = ['supermarket', 'school', 'park', 'transit', 'gym', 'hospital'];
// the places said out loud, most useful first; the rest still appear on the map
const SAY_ORDER = ['supermarket', 'park', 'transit', 'school', 'gym', 'hospital'];
const FOR = { supermarket: 'for groceries', school: 'for school', park: 'for green space', transit: 'for transit', gym: 'for a workout', hospital: 'for a hospital' };

// ---- filling a template
// {name} is replaced by vars.name ({Name} capitalizes it); [ ... ] is dropped when a placeholder
// inside it is empty; a line with an empty placeholder outside brackets returns null
export function fill(tpl, vars) {
  if (!tpl) return null;
  const val = (k) => { const v = vars[k.charAt(0).toLowerCase() + k.slice(1)]; return v == null || v === '' ? '' : (k.charAt(0) === k.charAt(0).toUpperCase() ? cap(String(v)) : String(v)); };
  let out = tpl.replace(/\[([^\]]*)\]/g, (_, inner) => { const keys = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]); return keys.some((k) => !val(k)) ? '' : inner; });
  let missing = false;
  out = out.replace(/\{(\w+)\}/g, (_, k) => { const v = val(k); if (!v) missing = true; return v; });
  if (missing) return null;
  out = out.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/([.,;:])\1+/g, '$1').trim();
  return cap(out);
}
function fromPool(key, vars, slot = key) {
  const ok = (POOLS[key] || []).map((t) => fill(t, vars)).filter(Boolean);
  return ok.length ? pick(`pool-${slot}`, ok) : null;
}

// ---- the places, said as one flowing line
function placeName(cat, p) {
  const label = PLACE_LABEL[cat] || 'place';
  const generic = !!p.name && /^(bus|tram|train|rail|metro|subway|light rail) (stop|station)$/i.test(p.name.trim());
  const named = !!p.name && p.name !== label && !generic;
  return { name: named ? p.name : `the nearest ${(generic ? p.name.trim() : label).toLowerCase()}`, named };
}
function placeClauses(items) {
  const walkForms = shuffle([
    (x) => `${x.name} is ${an(x.n)} ${x.n} minute walk`,
    (x) => `${x.why}, ${x.name} is ${x.n} minutes on foot`,
    (x) => `${x.name} is ${x.n} minutes away on foot`,
    (x) => `you can walk to ${x.name} in ${x.n} minutes`,
  ]);
  const driveForms = shuffle([
    (x) => `${x.name} is about ${an(x.n)} ${x.n} minute drive`,
    (x) => `${x.why}, ${x.name} is about ${x.n} minutes by car`,
    (x) => `${x.name} is about ${x.n} minutes by car`,
  ]);
  let w = 0, d = 0;
  const out = items.map((x, i) => {
    // the "for groceries, ..." shape only opens a sentence, where its comma reads cleanly
    let f;
    for (let k = 0; k < 4; k++) { f = x.walk ? walkForms[(w + k) % walkForms.length] : driveForms[(d + k) % driveForms.length]; if (!(i % 2) || !String(f(x)).startsWith(x.why)) break; }
    if (x.walk) w++; else d++;
    return f(x);
  });
  // two places to a sentence, so it reads like speech rather than a list
  const parts = [];
  for (let i = 0; i < out.length; i += 2) parts.push(out.slice(i, i + 2).join(', and '));
  return parts.map((s, i) => (i ? cap(s) : s)).join('. ');
}
const nounList = (items, unit) => list(items.map((x, i) => `${x.name} in ${x.walk ? '' : 'about '}${x.n}${i === 0 ? ` ${unit}` : ''}`));

// ---- what kind of home this is
export function conditions(l, d) {
  const kind = l.kind === 'apartments' || (l.price == null && (l.rent != null || d?.apartment)) ? 'rent' : l.kind === 'sold' ? 'sold' : 'sale';
  const ps = PLACES.map((c) => d?.places?.[c]?.[0]).filter(Boolean);
  const ratio = ps.length ? ps.filter((p) => p.walkMin <= 15).length / ps.length : null;
  const walk = ratio == null ? 'none' : ratio >= 0.75 ? 'walkable' : ratio <= 0.25 ? 'drive' : 'mixed';
  const v = d?.value;
  const deal = v && v.n >= 2 && v.lowerThanPct != null ? (v.lowerThanPct >= 60 ? 'deal' : v.lowerThanPct <= 25 ? 'premium' : 'fair') : 'none';
  return { kind, walk, deal };
}

// ---- picking a script: one that fits, not used in the last forty showings
let recent = null;
const RECENT_KEY = 'gpa-scripts';
function recall() {
  if (recent) return recent;
  try { recent = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) || '[]'); } catch { recent = []; }
  if (!Array.isArray(recent)) recent = [];
  return recent;
}
export function chooseScript(cond) {
  const fits = SCRIPTS.filter((s) => s.kind === cond.kind && Object.entries(s.when).every(([k, v]) => cond[k] === v));
  const specific = fits.filter((s) => Object.keys(s.when).length);
  const used = recall();
  const fresh = (a) => a.filter((s) => !used.includes(s.id));
  // scripts written for this kind of place come up a little more often than the general ones
  let pool = specific.length && Math.random() < 0.55 ? fresh(specific) : [];
  if (!pool.length) pool = fresh(fits);
  if (!pool.length) pool = [...fits].sort((a, b) => used.indexOf(a.id) - used.indexOf(b.id)).slice(0, 3); // every one used lately: the least recent
  const s = pool[Math.floor(Math.random() * pool.length)] || SCRIPTS[0];
  used.push(s.id);
  while (used.length > 40) used.shift();
  try { globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(used)); } catch { /* private mode */ }
  return s;
}

// what the rest of the cards are called when she points to them
const REST_NAME = { errands: 'errands and commute', outdoors: 'the outdoors', activity: 'shops and businesses nearby', schools: 'schools nearby', income: 'area facts', noise: 'a street noise check', value: 'price and value', energy: 'energy', hoa: 'HOA and community' };

// which cards the panel will have for this home (the same tests as src/panel.js)
export function cardKeys(d) {
  if (!d) return [];
  const f = d.facts || {}, a = d.apartment, h = d.home || {}, r = d.risk || {}, n = d.noise;
  const keys = [];
  if (f.ppsf) keys.push('value');
  if (d.cost) keys.push('cost');
  else if ((a ? a.rentMin : f.rent) || a) keys.push('rent');
  keys.push('errands', 'outdoors');
  if (d.energy) keys.push('energy');
  if (r.nri || r.flood) keys.push('risk');
  if ((d.activity?.facts || []).length) keys.push('activity');
  if ((d.places?.school || []).length || (h.schools || []).length) keys.push('schools');
  if (h.hoa || (a ? a.amenities || [] : h.community || []).length) keys.push('hoa');
  if (d.census?.income) keys.push('income');
  if (n && (n.highway || n.rail || n.airport)) keys.push('noise');
  return keys;
}

// opts: intro (the first time she speaks this game), told (topics already said about this home,
// so she does not repeat them), cost (costFor() result), downPct, amenities (amenityList())
export function buildScript(l, d, row, opts = {}) {
  const told = opts.told || new Set();
  const cond = conditions(l, d);
  const script = chooseScript(cond);
  const f = d?.facts || {}, a = d?.apartment, h = d?.home || {}, c = opts.cost, so = d?.solar || {};
  const beds = l.beds != null ? (Number(l.beds) === 0 ? 'a studio' : `${l.beds} bedroom${Number(l.beds) === 1 ? '' : 's'}`) : '';
  const sqft = l.sqft ? `${Number(l.sqft).toLocaleString('en-US')} square feet` : '';
  const vars = { beds, sqft, what: [beds, sqft].filter(Boolean).join(' and ') };
  if (l.price != null) vars.price = usd(l.price);
  if (cond.kind === 'sold' && l.price != null) {
    // Texas does not disclose sale prices: a sold home there shows its last asking price
    const asking = f.askingOnly || /ask/i.test(f.priceLabel || '');
    vars.price_is = asking ? `its last asking price was ${usd(l.price)}` : `it sold for ${usd(l.price)}`;
  }
  const rentFrom = l.rent || row?.rent || a?.rentMin || f.rent || 0;
  if (rentFrom) vars.rent = usd(rentFrom);
  vars.place_name = l.name || (l.kind === 'apartments' ? 'this community' : 'a home for rent');
  if (a?.unitsAvailable > 0) vars.open = String(a.unitsAvailable);
  const plans = (a?.plans || []).filter((p) => p.rentMin).length;
  if (plans > 1) vars.plans = String(plans);

  // the rings
  const mins = (d?.rings?.walk || []).map((r) => r.min).sort((x, y) => x - y);
  if (mins.length) vars.rings = mins.length > 1 ? `${list(mins.map(String))} minutes` : `${mins[0]} minutes`;

  // the places: at most five said out loud, in the order their pins appear
  const all = SAY_ORDER.map((cat) => ({ cat, p: d?.places?.[cat]?.[0] })).filter((x) => x.p)
    .map(({ cat, p }) => { const walk = p.walkMin <= 15; return { cat, walk, n: walk ? p.walkMin : p.driveMin, why: FOR[cat] || 'nearby', ...placeName(cat, p) }; });
  let spoken = all.slice(0, 4);
  const walks = all.filter((x) => x.walk), drives = all.filter((x) => !x.walk);
  if (cond.walk === 'walkable' || cond.walk === 'drive' || cond.walk === 'mixed') spoken = [...walks.slice(0, 4), ...drives.slice(0, Math.max(1, 5 - Math.min(4, walks.length)))].slice(0, 5);
  if (all.length) {
    vars.places = placeClauses(spoken);
    const sw = spoken.filter((x) => x.walk), sd = spoken.filter((x) => !x.walk);
    if (sw.length) vars.walk_list = nounList(sw, 'minutes');
    if (sd.length) vars.drive_list = nounList(sd, 'minutes');
  }

  // the money
  const v = d?.value;
  if (v && v.n >= 2 && v.lowerThanPct != null) { vars.pct = `${v.lowerThanPct}%`; vars.n = String(v.n); vars.within = v.radiusKm != null ? `within ${v.radiusKm} km` : 'nearby'; }
  if (f.ppsf) vars.ppsf = usd(f.ppsf);
  if (c?.total) { vars.total = usd(c.total); vars.down = `${opts.downPct ?? 20}%`; vars.loan = usd(c.mortgage); vars.tax = usd(c.tax); }
  const rv = d?.rentVsBuy;
  if (rv?.medianRent && rv.beds) { vars.rv_rent = usd(rv.medianRent); vars.rv_beds = `${rv.beds} bed`; }
  if (so.panels) { vars.panels = String(so.panels); vars.save = usd(so.savingsYear); }
  if (d?.energy?.billMonth) vars.bill = usd(d.energy.billMonth);
  if (so.panels && so.coverPct && !so.existing) vars.cover = `${so.coverPct}%`;
  if (d?.cost?.insurance) vars.ins = usd(d.cost.insurance);
  if (h.hoa?.fee) vars.hoa = usd(h.hoa.fee);
  const covers = (h.hoa?.lines || []).map((x) => (/include/i.test(x) ? x.replace(/^.*?include[s]?\s*/i, '').split(/,\s*/) : [])).flat().filter(Boolean).slice(0, 3).map((x) => x.toLowerCase());
  if (covers.length) vars.covers = list(covers);
  const amen = (opts.amenities || []).slice(0, 4).map((x) => String(x).toLowerCase());
  if (amen.length) vars.amen = list(amen);

  const have = cardKeys(d);
  const steps = [];
  const add = (key, stock, extra = {}) => { if (stock) steps.push({ key, stock, must: [], max: 36, ...extra }); };

  // the opening: who she is (once per game), then the home, unless it was just introduced on arrival
  const hello = opts.intro ? pick('rv-hello', ["I'm Maya, your agent. ", "Hi, I'm Maya, your agent. ", "Maya here, I'm your agent. "]) : '';
  const intro = told.has('home') ? fromPool('intro_again', vars) : fill(script.intro, vars) || fromPool('intro_again', vars);
  add('home', hello + intro, { must: opts.intro ? ['Maya'] : [], max: 40 });
  if (vars.rings) add('walk', fill(script.walk, vars), { max: 26 });
  if (all.length) {
    const line = fill(script.places, vars) || fill('{Places}.', vars);
    const named = spoken.filter((x) => x.named && line.includes(x.name)).map((x) => x.name);
    add('places', line, { must: named.slice(0, 4), max: Math.min(64, line.split(/\s+/).length + 12), order: [...spoken.map((x) => x.cat), ...all.filter((x) => !spoken.includes(x)).map((x) => x.cat)] });
  }
  if (so.panels) add('roof', fromPool('roof', vars), { max: 30 });
  else if (d?.aerial?.solar) add('roof', fromPool('roof_has', vars), { max: 24 });

  if (cond.kind === 'rent') {
    if (have.includes('rent') || vars.rent) add('card_rent', fill(script.rent, vars), { card: 'rent', max: 34 });
  } else {
    // a price well above similar homes gets a line written for that, not "lower than 3%"
    const value = cond.deal === 'premium' && script.when.deal !== 'premium' ? fromPool('value_premium', vars) : fill(script.value, vars);
    if (have.includes('value')) add('card_value', value || fromPool('value_ppsf', vars), { card: 'value', max: 40 });
    if (have.includes('cost')) add('card_cost', fill(script.cost, vars), { card: 'cost', max: 40 });
    if (vars.ins) add('card_insurance', fromPool('insurance', vars), { card: 'cost', must: ['insur', 'average'], max: 30 });
  }
  if (have.includes('energy') && vars.bill) add('card_energy', fromPool('energy', vars), { card: 'energy', max: 34 });
  if (have.includes('hoa')) {
    // amenities alone are not an HOA: their own key, so a reworded line is not led there
    if (vars.hoa) add('card_hoa', fromPool('hoa', vars), { card: 'hoa', must: ['HOA'], max: 34 });
    else if (vars.amen) add('card_amenities', fromPool('amen', vars), { card: 'hoa', max: 34 });
    else if (d?.cost) add('card_hoa', fromPool('nohoa', vars), { card: 'hoa', must: ['HOA'], max: 20 });
  }
  const said = new Set(steps.map((s) => s.card).filter(Boolean));
  const more = have.filter((k) => !said.has(k) && k !== 'risk' && REST_NAME[k]).map((k) => REST_NAME[k]).slice(0, 4);
  if (more.length) vars.more = list(more);
  add('rest', fill(script.close, vars) || fromPool('close', vars), { max: 30 });
  for (const s of steps) s.script = script.id;
  return { steps, script: script.id, cond };
}
