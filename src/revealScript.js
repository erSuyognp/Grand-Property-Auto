// What Maya says while the map opens up around a home. One step per thing the reveal shows:
// on the map the home, the walk rings, each nearest place, the roof and a flood zone; then the
// insight panel, one card at a time (price and value, the monthly cost or the rent, energy,
// risk, HOA), and a last line that opens the rest of the cards. A step carries
//   title, figure, unit, sub   what the big caption shows (the number first, large)
//   card                       the panel card the step opens and lights (panel steps only)
//   stock                      one of several stock phrasings, picked at random and never the
//                              one used last time, built only from the home's own insight file
//   must, max                  what a line written by the model has to keep (src/lines.js)
// With the model on, each stock line is said again in the model's own words and checked
// against the stock line (src/voiceLines.js). Calculated numbers say "estimated" or "about".
import { pick } from './lines.js';
import { PLACE_ICON, PLACE_LABEL } from './icons.js';
import { factsText } from './format.js';

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const an = (n) => (/^(8|11|18|8\d)$/.test(String(n)) ? 'an' : 'a');
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const low = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
// a sentence after a linking word ("Next, ") keeps its own case; alone it starts with a capital
const led = (lead, s) => (lead ? lead + s : cap(s));
const FOR = { supermarket: 'for groceries', school: 'for school', park: 'for green space', transit: 'for transit', gym: 'for a workout', hospital: 'for a hospital' };
const LINKS = ['Next, ', 'Then ', 'And ', 'After that, ', 'Also, ', 'Now '];
const LINKS_WALK = LINKS;

export function homeStep(l, d, row, intro) {
  const f = d?.facts || {};
  const beds = l.beds != null ? (Number(l.beds) === 0 ? 'a studio' : `${l.beds} bedroom${Number(l.beds) === 1 ? '' : 's'}`) : '';
  const size = l.sqft ? `${Number(l.sqft).toLocaleString('en-US')} square feet` : '';
  const what = [beds, size].filter(Boolean).join(' and ');
  const hello = intro ? pick('rv-hello', ["I'm Maya, your agent. ", "Hi, I'm Maya, your agent. ", "Maya here, I'm your agent. "]) : '';
  const must = intro ? ['Maya'] : [];
  if (l.kind === 'apartments') {
    const rent = l.rent || row?.rent || d?.apartment?.rentMin || 0;
    const name = l.name || 'this community';
    if (l.name) must.push(l.name);
    return {
      key: 'home', icon: 'building-2', title: 'This community', figure: rent ? `From ${usd(rent)}` : 'Apartments', unit: rent ? '/mo' : '', sub: l.name || 'Apartment community', must, max: 36,
      stock: hello + pick('rv-home-apt', [
        `This is ${name}${rent ? `. Rents here start at ${usd(rent)} a month` : ''}. Let me show you what living here is like.`,
        `${cap(name)}${rent ? `, where rents start at ${usd(rent)} a month` : ''}. Watch the map, I'll walk you through what is around it.`,
        `Here is ${name}${rent ? `, with rents from ${usd(rent)} a month` : ''}. Let's see what you get beyond the front door.`,
        `Welcome to ${name}${rent ? `. Rent starts at ${usd(rent)} a month` : ''}. I'll take you around it from above.`,
        `${rent ? `From ${usd(rent)} a month, this is ${name}` : `This is ${name}`}. Let me show you the neighborhood first.`,
      ]),
    };
  }
  let priced = '', tag = '';
  if (l.price == null && l.rent != null) { priced = `it rents for ${usd(l.rent)} a month`; tag = 'rent'; }
  else if (l.price != null && l.kind === 'sold') {
    // Texas does not disclose sale prices: a sold home there shows its last asking price
    const asking = f.askingOnly || /ask/i.test(f.priceLabel || '');
    priced = asking ? `its last asking price was ${usd(l.price)}` : `it sold for ${usd(l.price)}`;
    tag = asking ? 'last asking price' : 'sold for';
  } else if (l.price != null) { priced = pick('rv-listed', [`it is listed at ${usd(l.price)}`, `it is on the market at ${usd(l.price)}`, `the asking price is ${usd(l.price)}`]); tag = 'asking price'; }
  const figure = l.price != null ? usd(l.price) : l.rent != null ? usd(l.rent) : 'This home';
  const sub = [tag, factsText(l)].filter(Boolean).join(' · ');
  const stock = priced
    ? pick('rv-home', [
      `${cap(priced)}${what ? `, with ${what}` : ''}. Let me show you what living here is like.`,
      `${what ? cap(what) : 'This home'}, and ${priced}. Watch the map, I'll walk you through what is around it.`,
      `So, ${priced}${what ? `, with ${what}` : ''}. Here is what you get beyond the front door.`,
      `${cap(priced)}${what ? `, and that buys ${what}` : ''}. Let's look at the neighborhood from above.`,
      `Here's the one: ${what ? `${what}, and ` : ''}${priced}. I'll show you around it from up here.`,
      `${what ? `${cap(what)}. ` : ''}${cap(priced)}. Now let's see what is around it.`,
    ])
    : pick('rv-home-bare', [`${what ? `This one has ${what}` : 'Here is the home'}. Let me show you what living here is like.`, `${what ? cap(what) : 'This is the home'}. Watch the map, I'll walk you through what is around it.`, `${what ? `Here's the one: ${what}` : 'Here is the one'}. Let's look around it from above.`]);
  return { key: 'home', icon: 'house', title: 'This home', figure, unit: l.price == null && l.rent != null ? '/mo' : '', sub, stock: hello + stock, must, max: 36 };
}

export function walkStep(rings) {
  const mins = [...rings].map((r) => r.min).sort((a, b) => a - b);
  const said = list(mins.map(String));
  const stock = mins.length > 1
    ? pick('rv-walk', [
      `Start on foot. These rings are roughly ${said} minutes from the door.`,
      `First, how far you get without a car: roughly ${said} minutes of walking, one ring each.`,
      `Each ring is a walk from the front door, roughly ${said} minutes. The times I give you next follow the real streets.`,
      `On foot first. The rings mark roughly ${said} minutes from the door.`,
      `Picture leaving the car at home. Roughly ${said} minutes on foot gets you to each of these rings.`,
      `These circles are walking distance: roughly ${said} minutes out from the door.`,
    ])
    : pick('rv-walk1', [`This ring is roughly ${an(mins[0])} ${mins[0]} minute walk from the door.`, `On foot first: the ring marks roughly ${mins[0]} minutes from the door.`, `Everything inside this ring is roughly ${mins[0]} minutes away on foot.`]);
  return { key: 'walk', icon: 'footprints', title: 'On foot', figure: mins.join(' · '), unit: 'min', sub: 'rough walking rings from the door', stock, must: [], max: 30 };
}

// k: the place's turn among the places (0 for the first), flow: the story's linking words
export function placeStep(cat, p, k = 0, flow = null) {
  const label = PLACE_LABEL[cat] || 'Place';
  // a name that only says what it is ("Bus stop") reads as "the nearest bus stop", not as a proper name
  const generic = !!p.name && /^(bus|tram|train|rail|metro|subway|light rail) (stop|station)$/i.test(p.name.trim());
  const named = !!p.name && p.name !== label && !generic;
  const name = named ? p.name : `the nearest ${(generic ? p.name.trim() : label).toLowerCase()}`;
  const walk = p.walkMin <= 15, n = walk ? p.walkMin : p.driveMin;
  const why = FOR[cat] || `for the ${label.toLowerCase()}`;
  const lead = k === 0 ? '' : flow ? flow.lead(walk ? LINKS_WALK : LINKS) : '';
  const stock = walk
    ? pick(`rv-walkto-${cat}`, [
      led(lead, `${name} is ${an(n)} ${n} minute walk.`),
      led(lead, `${why}, ${name} is ${n} minutes on foot.`),
      led(lead, `${n} minutes on foot gets you to ${name}.`),
      led(lead, `${name}: ${n} minutes, walking.`),
      led(lead, `you can walk to ${name} in ${n} minutes.`),
      led(lead, `${why}, it's ${an(n)} ${n} minute walk to ${name}.`),
    ])
    : pick(`rv-driveto-${cat}`, [
      led(lead, `${name} is about ${an(n)} ${n} minute drive.`),
      led(lead, `${why}, ${name} is about ${n} minutes by car.`),
      led(lead, `by car, ${name} is about ${n} minutes away.`),
      led(lead, `${name} is a drive, about ${n} minutes.`),
      led(lead, `${why}, plan on about ${n} minutes in the car to ${name}.`),
    ]);
  return { key: `place_${cat}`, cat, icon: PLACE_ICON[cat] || 'map-pin', title: label, figure: String(n), unit: walk ? 'min walk' : 'min drive', sub: named ? p.name : label, stock, must: named ? [p.name] : [], max: 22 };
}

export function roofStep(solar, aerial) {
  if (solar?.panels) {
    const save = usd(solar.savingsYear);
    return {
      key: 'roof', icon: 'sun', title: 'The roof', figure: save, unit: 'a year', sub: `solar estimate · about ${solar.panels} panels`, must: [], max: 30,
      stock: pick('rv-roof', [
        `The roof fits about ${solar.panels} solar panels, which could save an estimated ${save} a year.`,
        `Up on the roof there is room for about ${solar.panels} panels. That is an estimated ${save} a year off the power bill.`,
        `Solar would work here: about ${solar.panels} panels, for an estimated ${save} a year saved.`,
        `Look at the roof. About ${solar.panels} panels would fit, worth an estimated ${save} a year.`,
        `Those blue tiles are solar: about ${solar.panels} panels fit up there, saving an estimated ${save} a year.`,
      ]),
    };
  }
  if (!aerial?.solar) return null;
  return {
    key: 'roof', icon: 'sun', title: 'The roof', figure: 'Solar', unit: 'already on the roof', sub: 'seen from the air', must: [], max: 24,
    stock: pick('rv-roof-has', ['Solar panels are already on the roof, seen from the air.', 'From the air you can see solar panels already on this roof.', 'This roof already carries solar panels: they show from the air.', 'One nice detail from the air: the roof already has solar panels.']),
  };
}

export function floodStep(flood) {
  const label = String(flood.label || 'High risk flood zone').replace(/\.$/, '');
  return {
    key: 'flood', icon: 'waves', title: 'Flood zone', figure: flood.zone ? `Zone ${flood.zone}` : 'Flood zone', unit: '', sub: 'FEMA flood map', must: [], max: 32,
    stock: pick('rv-flood', [
      `${label}. A lender will likely require flood insurance.`,
      `One thing to know: ${low(label)}, so a lender will likely require flood insurance.`,
      `The blue area is the flood map. ${label}, and a lender will likely require flood insurance.`,
      `Worth knowing before you fall for it: ${low(label)}. A lender will likely ask for flood insurance.`,
    ]),
  };
}

// ---- the insight panel, one card at a time
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

function valueStep(d, flow) {
  const v = d.value, f = d.facts || {};
  const asking = f.askingOnly ? ' That is its last asking price: Texas does not disclose sale prices.' : '';
  const base = { key: 'card_value', card: 'value', icon: 'scale', title: 'Price and value', must: f.askingOnly ? ['asking'] : [], max: 40 };
  if (v && v.n >= 2 && v.lowerThanPct != null) {
    const pct = v.lowerThanPct, n = v.n, within = v.radiusKm != null ? ` within ${v.radiusKm} km` : ' nearby';
    const lead = flow.lead(['Now the numbers. ', 'Over to the details. ', 'Now the panel. ', 'On to the money. '], 0.3);
    return { ...base, figure: `${pct}%`, unit: 'lower than similar', sub: `${n} similar homes${within} · per square foot`,
      stock: lead + pick('rv-value', [
        `Per square foot, it is priced lower than ${pct}% of the ${n} similar homes${within}.`,
        `Against ${n} similar homes nearby, it comes in lower than ${pct}% of them per square foot.`,
        `Price first: lower than ${pct}% of ${n} similar homes${within}, by price per square foot.`,
        `I compared it with ${n} similar homes${within}. Per square foot, it is priced lower than ${pct}% of them.`,
      ]) + asking };
  }
  if (!f.ppsf) return null;
  return { ...base, figure: usd(f.ppsf), unit: '/sq ft', sub: 'not enough similar homes nearby to compare',
    stock: pick('rv-value-ppsf', [`It works out to ${usd(f.ppsf)} per square foot. There are not enough similar homes nearby to compare it with.`, `Per square foot it is ${usd(f.ppsf)}. Too few similar homes nearby for a fair comparison.`]) + asking };
}

function costStep(d, cost, downPct) {
  if (!cost?.total) return null;
  const total = usd(cost.total), loan = usd(cost.mortgage), tax = usd(cost.tax), ins = usd(cost.insurance);
  const rv = d.rentVsBuy;
  const vs = rv?.medianRent && rv.beds ? pick('rv-cost-vs', [` Renting a similar ${rv.beds} bed nearby is about ${usd(rv.medianRent)}.`, ` For comparison, a similar ${rv.beds} bed rents for about ${usd(rv.medianRent)} nearby.`, '']) : '';
  return {
    key: 'card_cost', card: 'cost', icon: 'wallet', title: 'True monthly cost', figure: total, unit: '/mo', sub: `estimate · ${downPct}% down`, must: [], max: 44,
    stock: pick('rv-cost', [
      `All in, owning it runs an estimated ${total} a month with ${downPct}% down. The biggest part is the ${loan} loan payment.`,
      `The true monthly cost is an estimated ${total} at ${downPct}% down: the loan, ${tax} of property tax and ${ins} of insurance from the state average.`,
      `Add up the loan, tax, insurance and power and you get an estimated ${total} a month, with ${downPct}% down.`,
      `Here is what it really costs: an estimated ${total} a month at ${downPct}% down, and ${loan} of that is the loan.`,
      `With ${downPct}% down, plan on an estimated ${total} a month all in. Insurance is the state average, not a quote.`,
    ]) + vs,
  };
}

function rentStep(d, row) {
  const a = d.apartment, rent = a?.rentMin || d.facts?.rent || row?.rent || 0;
  if (!rent) return null;
  const open = a?.unitsAvailable;
  const plans = (a?.plans || []).filter((p) => p.rentMin).length;
  return {
    key: 'card_rent', card: 'rent', icon: 'wallet', title: 'Rent', figure: usd(rent), unit: '/mo', sub: a ? 'lowest rent, from the listing' : 'rent, from the listing', must: [], max: 36,
    stock: pick('rv-rent', [
      `Rent starts at ${usd(rent)} a month${open ? `, and ${open} homes are open right now` : ''}.`,
      `The lowest rent here is ${usd(rent)} a month${plans > 1 ? `, across ${plans} floor plans in the panel` : ''}.`,
      `Money first: from ${usd(rent)} a month${open ? `, with ${open} homes available` : ''}.`,
      `${plans > 1 ? `There are ${plans} floor plans, starting at ${usd(rent)} a month` : `It starts at ${usd(rent)} a month`}.`,
    ]),
  };
}

function energyStep(d, flow) {
  const e = d.energy, so = d.solar || {};
  if (!e?.billMonth) return null;
  const bill = usd(e.billMonth);
  const sun = so.panels && so.coverPct && !so.existing ? pick('rv-energy-sun', [` Solar could cover about ${so.coverPct}% of it.`, ` Panels on the roof could cover about ${so.coverPct}% of that.`, '']) : '';
  const lead = flow.lead(['Then ', 'Next, ', 'And '], 0.4);
  return {
    key: 'card_energy', card: 'energy', icon: 'zap', title: 'Energy and solar', figure: bill, unit: '/mo', sub: 'electric bill · estimate', must: [], max: 34,
    stock: pick('rv-energy', [
      led(lead, `the electric bill is estimated at about ${bill} a month.`),
      led(lead, `expect an electric bill of about ${bill} a month, as an estimate.`),
      led(lead, `power runs an estimated ${bill} a month.`),
      led(lead, `the estimated electric bill comes to about ${bill} a month.`),
    ]) + sun,
  };
}

function riskStep(d) {
  const r = d.risk || {}, n = r.nri;
  const top = (n?.top || []).slice(0, 2).map((x) => String(x.hazard).toLowerCase());
  if (n?.rating) {
    const rating = String(n.rating).toLowerCase();
    return {
      key: 'card_risk', card: 'risk', icon: 'shield', title: 'Risk and insurance', figure: n.rating, unit: '', sub: 'FEMA natural hazard risk', must: ['FEMA'], max: 36,
      stock: pick('rv-risk', [
        `FEMA rates natural hazard risk here ${rating}${top.length ? `, mostly ${list(top)}` : ''}. Ask an insurer for a real quote.`,
        `On risk, FEMA rates this area ${rating}${top.length ? `, with ${list(top)} at the top of the list` : ''}.`,
        `FEMA's hazard rating for this spot: ${rating}${top.length ? `. The main ones are ${list(top)}` : ''}.`,
        `${top.length ? `${cap(list(top))} lead the hazard list here, and ` : ''}FEMA rates the overall risk ${rating}.`,
      ]),
    };
  }
  if (r.flood?.label && !r.flood.sfha) {
    const label = String(r.flood.label).replace(/\.$/, '');
    return { key: 'card_risk', card: 'risk', icon: 'shield', title: 'Risk and insurance', figure: r.flood.zone ? `Zone ${r.flood.zone}` : 'Flood map', unit: '', sub: 'FEMA flood map', must: [], max: 30,
      stock: pick('rv-risk-flood', [`On the FEMA flood map: ${low(label)}.`, `The FEMA flood map says ${low(label)}.`]) };
  }
  return null;
}

function hoaStep(d) {
  const h = d.home || {}, a = d.apartment;
  const covers = (h.hoa?.lines || []).map((x) => (/include/i.test(x) ? x.replace(/^.*?include[s]?\s*/i, '').split(/,\s*/) : [])).flat().filter(Boolean).slice(0, 3).map((x) => x.toLowerCase());
  const amen = (a ? a.amenities || [] : h.community || []).slice(0, 4).map((x) => String(x).toLowerCase());
  const base = { key: 'card_hoa', card: 'hoa', icon: 'landmark', must: [], max: 36 };
  if (h.hoa?.fee) {
    const fee = usd(h.hoa.fee);
    return { ...base, title: 'HOA and community', figure: fee, unit: '/mo', sub: 'HOA fee, from the listing',
      stock: pick('rv-hoa', [
        `There is an HOA fee of ${fee} a month${covers.length ? `, and it covers ${list(covers)}` : '. The listing does not say what it covers'}.`,
        `Add ${fee} a month for the HOA${covers.length ? `. That includes ${list(covers)}` : ''}.`,
        `The HOA here is ${fee} a month${covers.length ? `, covering ${list(covers)}` : ''}.`,
      ]) };
  }
  // amenities alone are not an HOA: a key without "hoa" in it, so the wording is not led there
  if (amen.length) return { ...base, key: 'card_amenities', title: a ? "What's included" : 'HOA and community', figure: 'Amenities', unit: '', sub: 'from the listing',
    stock: pick('rv-amen', [`It comes with ${list(amen)}.`, `The listing names ${list(amen)}.`, `Amenities include ${list(amen)}.`, `You also get ${list(amen)}.`]) };
  if (h.hoa || d.cost) return { ...base, title: 'HOA and community', figure: 'No HOA fee', unit: '', sub: 'none listed',
    stock: pick('rv-nohoa', ['No HOA fee is listed for this one.', 'The listing shows no HOA fee.', 'And no HOA fee is listed.']) };
  return null;
}

// what the rest of the cards are called when she points to them
const REST_NAME = { errands: 'errands and commute', outdoors: 'the outdoors', activity: 'shops and businesses nearby', schools: 'schools nearby', income: 'area facts', noise: 'a street noise check', value: 'price and value', energy: 'energy', risk: 'risk', hoa: 'HOA and community' };

function restStep(rest) {
  const names = rest.map((k) => REST_NAME[k]).filter(Boolean);
  const said = list(names.slice(0, 4));
  return {
    key: 'rest', icon: 'sparkles', title: 'Everything else', figure: 'All the details', unit: '', sub: 'every card has an i for its source', must: [], max: 36,
    stock: names.length
      ? pick('rv-rest', [
        `The rest is in the panel too: ${said}. Every card has an i that shows its source.`,
        `Below that you'll find ${said}, each with its source behind the i.`,
        `That's the tour from above. Scroll the panel for ${said}, and press the i on any card to see where it comes from.`,
        `I'll leave you with the rest: ${said}. Every number there has a source.`,
      ])
      : pick('rv-rest-none', ['That is everything. Every card has an i that shows where its numbers come from.', 'And that is the whole picture. Each card shows its source behind the i.']),
  };
}

// the panel part of the story, in the order of the cards in the panel
export function panelSteps(d, row, cost, downPct, flow) {
  if (!d) return [];
  const have = cardKeys(d);
  const steps = [valueStep(d, flow), d.cost ? costStep(d, cost, downPct) : rentStep(d, row), energyStep(d, flow), riskStep(d), hoaStep(d)].filter((s) => s && have.includes(s.card));
  const told = new Set(steps.map((s) => s.card));
  steps.push(restStep(have.filter((k) => !told.has(k))));
  return steps;
}
