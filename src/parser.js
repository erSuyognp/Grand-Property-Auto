// Local keyword parser: turns one spoken line into mission filters with no network at all.
// Used by the browser when the server is unreachable and by the server when the LLM is off,
// slow or wrong. It must handle every line in DEMO_SCRIPT.md on its own. Pure JS (no DOM),
// so the Node server imports it too.

const WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2 };
const NUM = '(\\d[\\d,]*(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|a|an)';

export const EMPTY_FILTERS = { kind: null, minPrice: null, maxPrice: null, minRent: null, maxRent: null, minBeds: null, minBaths: null, minSqft: null, minLotAcres: null, pool: null, features: [] };

const FEATURES = [
  ['garage', /\bgarage\b/], ['fireplace', /\bfire ?place\b/], ['island kitchen', /\b(island kitchen|kitchen island)\b/],
  ['hardwood', /\bhard ?wood\b/], ['yard', /\b(back ?yard|big yard|fenced yard|yard)\b/], ['office', /\b(home office|office)\b/],
  ['patio', /\b(patio|deck|porch)\b/], ['balcony', /\bbalcon(y|ies)\b/], ['view', /\b(view|views)\b/], ['new', /\b(new construction|brand new|newly built)\b/],
  ['schools', /\b(good|great|top) schools?\b/], ['gym', /\b(gym|fitness)\b/], ['walk in closet', /\bwalk.?in closet\b/], ['solar', /\bsolar\b/],
  ['gated', /\bgated\b/], ['elevator', /\belevator\b/], ['pet', /\b(pets?|dogs?(?! park)|cats?)\b/], ['washer', /\b(washer|laundry)\b/], ['open floor plan', /\bopen (floor ?plan|concept)\b/],
];
const NEAR = [
  ['park', /\bparks?\b/], ['school', /\bschools?\b/], ['shopping center', /\b(shops?|shopping|stores?|mall|groceries|grocery)\b/],
  ['playground', /\bplaygrounds?\b/], ['tennis court', /\btennis\b/], ['water', /\b(water|lake|bayou|river|pond)\b/],
];

function toNumber(tok) {
  if (tok == null) return null;
  tok = String(tok).toLowerCase();
  if (tok in WORDS) return WORDS[tok];
  const v = parseFloat(tok.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

// "900k", "$1.2 million", "2 mil", "900 thousand", "850,000", "half a million", "3000"
function moneyAt(text) {
  let m = /half\s+(?:a\s+)?(million|mil)\b/.exec(text);
  if (m) return { value: 500000, index: m.index, end: m.index + m[0].length };
  m = new RegExp(`\\$?\\s?${NUM}\\s?(k|grand|thousand|m|mil|mill|million|mm)?\\b`).exec(text);
  if (!m) return null;
  let v = toNumber(m[1]);
  if (v == null) return null;
  const unit = m[2];
  if (unit && /^(k|grand|thousand)$/.test(unit)) v *= 1e3;
  else if (unit) v *= 1e6;
  return { value: v, index: m.index, end: m.index + m[0].length, unit: !!unit, dollar: m[0].trim().startsWith('$') };
}

function looksLikeRent(v) {
  return v > 0 && v < 20000;
}

export function parseMission(transcript, context = {}) {
  const raw = String(transcript || '').trim();
  const t = ' ' + raw.toLowerCase().replace(/[’']/g, '').replace(/[?!;]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ') + ' ';
  const f = { ...EMPTY_FILTERS, features: [] };
  const out = { filters: f, near: [], relative: null, similar: false, action: null, reset: false, say: '' };

  // ---- actions that are not searches
  if (/\b(see it empty|empty (it|the room)|without (the )?furniture|remove (the )?furniture|unfurnished|defurnish)\b/.test(t)) out.action = 'empty';
  else if (/\b(walk|go|take me|step|head|lets go|let us go) (in|inside|into)\b|\b(tour|see) (it|this|the inside)\b|\bshow me (the )?inside\b/.test(t)) out.action = 'tour';
  else if (/\b(save|keep|bookmark|favorite|heart) (it|this|that)\b|\bsave this (one|home|house)\b|\badd (it|this) to my list\b/.test(t)) out.action = 'save';
  else if (/\b(exit|leave|get out|back to the car|go back outside|take me out)\b/.test(t)) out.action = 'exit';
  else if (/\b(compare|show my (saved|list|favorites)|my saved homes)\b/.test(t)) out.action = 'compare';
  else if (/\b(next (room|space|spot)|keep walking|go forward|move forward)\b/.test(t)) out.action = 'forward';
  if (/\b(start over|reset|clear (the )?(filters|search)|show (me )?everything|never mind|cancel)\b/.test(t)) out.reset = true;
  if (/\b(more|others?|another|similar|something) like (this|that|it)( one)?\b|\bsimilar (homes|ones|to this)\b|\blooks? like this\b/.test(t)) out.similar = true;

  // ---- relative follow ups ("something cheaper", "a bigger yard", "closer to a park")
  if (/\b(cheaper|less expensive|lower price|more affordable|not so expensive|too expensive|too pricey|costs less)\b/.test(t)) out.relative = 'cheaper';
  else if (/\b(bigger|larger|more space|more room|roomier|too small|more square)\b/.test(t)) out.relative = 'bigger';
  else if (/\b(closer|nearer)\b/.test(t)) out.relative = 'closer';
  else if (/\b(smaller|cozier|too big)\b/.test(t)) out.relative = 'smaller';
  else if (/\b(nicer|fancier|more expensive|higher end|upgrade)\b/.test(t)) out.relative = 'pricier';
  if (out.relative === 'bigger' && /\b(yard|lot|land|garden|outdoor)\b/.test(t)) out.relativeOf = 'lot';

  // ---- kind
  if (/\b(apartments?|apartment community|complex|lofts?)\b/.test(t)) f.kind = 'apartments';
  else if (/\b(rent|rental|rentals|renting|lease|leasing|to rent|for rent)\b/.test(t)) f.kind = 'rent';
  else if (/\b(recently sold|sold homes?|what sold|just sold)\b/.test(t)) f.kind = 'sold';
  else if (/\b(for sale|buy|buying|purchase|own)\b/.test(t)) f.kind = 'sale';

  // ---- bedrooms, bathrooms
  let m = new RegExp(`${NUM}\\s?\\+?(?: or more)?[- ]?(?:bed(?:room)?s?|br|bd)\\b`).exec(t);
  if (m) f.minBeds = toNumber(m[1]);
  if (/\bstudio\b/.test(t)) f.minBeds = 0;
  m = new RegExp(`${NUM}(?: and a half)?\\s?\\+?(?: or more)?[- ]?(?:bath(?:room)?s?|ba)\\b`).exec(t);
  if (m) f.minBaths = toNumber(m[1]);

  // ---- size
  m = new RegExp(`${NUM}\\s?(k)?\\s?(?:square feet|square foot|sq ?ft|sqft|sf)\\b`).exec(t);
  if (m) f.minSqft = toNumber(m[1]) * (m[2] ? 1000 : 1);
  m = new RegExp(`${NUM}\\s?acres?\\b`).exec(t);
  if (m) f.minLotAcres = toNumber(m[1]);
  if (/\bhalf (an )?acre\b/.test(t)) f.minLotAcres = 0.5;
  if (/\bquarter (of an )?acre\b/.test(t)) f.minLotAcres = 0.25;

  // ---- price or rent
  const priceText = t.replace(new RegExp(`${NUM}\\s?\\+?(?: or more)?[- ]?(?:bed(?:room)?s?|br|bd|bath(?:room)?s?|ba|acres?)\\b`, 'g'), ' ')
    .replace(new RegExp(`${NUM}\\s?(k)?\\s?(?:square feet|square foot|sq ?ft|sqft|sf)\\b`, 'g'), ' ')
    .replace(/\b(one|ones|a|an)\b/g, ' ');
  const setPrice = (lo, hi) => {
    const probe = hi ?? lo;
    const rent = f.kind === 'rent' || f.kind === 'apartments' || (/\b(a|per) month\b|\/mo\b|\bmonthly\b/.test(t)) || (f.kind == null && looksLikeRent(probe) && context.kind !== 'sale');
    if (rent) { if (lo != null) f.minRent = lo; if (hi != null) f.maxRent = hi; if (!f.kind) f.kind = 'rent'; } else { if (lo != null) f.minPrice = lo; if (hi != null) f.maxPrice = hi; }
  };
  const fix = (a, b) => { // "between 400 and 600k": give the first number the second one's unit
    if (a && b && !a.unit && b.unit && a.value < 1000) a.value *= b.value >= 1e6 && a.value < 20 ? 1e6 : 1e3;
    return a;
  };
  m = /\b(between|from)\b(.{1,24}?)\b(and|to)\b(.{1,24})/.exec(priceText);
  let done = false;
  if (m) {
    const b = moneyAt(m[4]), a = fix(moneyAt(m[2]), b);
    if (a && b && b.value > a.value) { setPrice(a.value, b.value); done = true; }
  }
  if (!done) {
    m = /\b(under|below|less than|at most|max(?:imum)?(?: of)?|up to|no more than|budget(?: is| of)?|cheaper than|within|not over)\b(.{1,26})/.exec(priceText);
    if (m) { const a = moneyAt(m[2]); if (a && (a.unit || a.dollar || a.value >= 400)) { setPrice(null, a.value); done = true; } }
    const m2 = /\b(over|above|more than|at least|min(?:imum)?(?: of)?|starting at|north of)\b(.{1,26})/.exec(priceText);
    if (m2) { const a = moneyAt(m2[2]); if (a && (a.unit || a.dollar || a.value >= 400)) { setPrice(a.value, null); done = true; } }
  }
  if (!done) {
    m = /\b(around|about|roughly|near|close to)\b(.{1,22})/.exec(priceText);
    const a = m && moneyAt(m[2]);
    if (a && (a.unit || a.dollar)) { setPrice(a.value * 0.85, a.value * 1.15); done = true; }
  }
  if (!done) { // a bare "$900k" or "900k" means a budget
    m = /\$\s?\d[\d,.]*\s?(k|m|million|thousand)?\b|\b\d[\d,.]*\s?(k|million|mil|thousand|grand)\b/.exec(priceText);
    const a = m && moneyAt(m[0]);
    if (a) setPrice(null, a.value);
  }

  // ---- pool, features, nearby
  if (/\b(no pool|without a pool)\b/.test(t)) f.pool = false;
  else if (/\b(pool|swimming)\b/.test(t)) f.pool = true;
  for (const [name, re] of FEATURES) if (re.test(t)) f.features.push(name);
  const nearCue = /\b(near|nearby|close to|closer to|next to|by a|by the|walk(?:ing)? distance|walk to|walkable|around the corner from|steps from)\b/.test(t);
  for (const [name, re] of NEAR) {
    if (!re.test(t)) continue;
    if (name === 'school' && f.features.includes('schools') && !nearCue) continue;
    if (nearCue || out.relative === 'closer') out.near.push(name);
  }
  if (out.relative === 'closer' && !out.near.length) out.near.push('park');
  // free words after "near": lets the server try a live semantic search for new words
  m = /\b(?:near|close to|closer to|next to|by)\s+(?:a |an |the |some )?([a-z][a-z ]{2,24}?)(?=\s+(?:and|with|under|below|for|that|in)\b|\s*$)/.exec(t.trim());
  if (m && !out.near.length) {
    const w = m[1].trim();
    if (w && !/\b(here|me|this|that|it|home|work)\b/.test(w)) out.near.push(w);
  }

  out.say = describe(out);
  out.empty = !out.action && !out.reset && !out.similar && !out.relative && !out.near.length && !f.features.length && f.pool == null
    && Object.entries(f).every(([k, v]) => k === 'features' || v == null);
  return out;
}

function shortMoney(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' million';
  if (v >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v).toLocaleString('en-US');
}

export function describe(p) {
  const f = p.filters;
  if (p.action === 'tour') return 'Heading inside.';
  if (p.action === 'save') return 'Saved it.';
  if (p.action === 'exit') return 'Back to the car.';
  if (p.action === 'empty') return 'Clearing out the furniture.';
  if (p.action === 'compare') return 'Here are your saved homes.';
  if (p.action === 'forward') return 'Moving on.';
  if (p.reset) return 'Starting fresh. Every home is back on the map.';
  if (p.similar) return 'Finding homes that look like this one from above.';
  if (p.relative === 'cheaper') return 'Got it, something cheaper.';
  if (p.relative === 'pricier') return 'Okay, something a step up.';
  if (p.relative === 'bigger') return p.relativeOf === 'lot' ? 'Okay, a bigger yard.' : 'Okay, something bigger.';
  if (p.relative === 'smaller') return 'Okay, something smaller.';
  if (p.relative === 'closer') return `Looking closer to a ${p.near[0] || 'park'}.`;
  const what = f.kind === 'apartments' ? 'apartments' : f.kind === 'rent' ? 'rentals' : f.kind === 'sold' ? 'recently sold homes' : 'homes';
  const bits = [];
  if (f.minBeds != null) bits.push(f.minBeds === 0 ? 'studios' : `${f.minBeds}+ beds`);
  if (f.minBaths != null) bits.push(`${f.minBaths}+ baths`);
  if (f.maxPrice != null && f.minPrice != null) bits.push(`${shortMoney(f.minPrice)} to ${shortMoney(f.maxPrice)}`);
  else if (f.maxPrice != null) bits.push(`under ${shortMoney(f.maxPrice)}`);
  else if (f.minPrice != null) bits.push(`over ${shortMoney(f.minPrice)}`);
  if (f.maxRent != null) bits.push(`under ${shortMoney(f.maxRent)} a month`);
  else if (f.minRent != null) bits.push(`over ${shortMoney(f.minRent)} a month`);
  if (f.minSqft != null) bits.push(`${f.minSqft.toLocaleString('en-US')}+ square feet`);
  if (f.minLotAcres != null) bits.push(`a lot over ${f.minLotAcres} acres`);
  if (f.pool) bits.push('a pool you can see from the air');
  for (const x of f.features) bits.push(x === 'schools' ? 'good schools' : x === 'new' ? 'new construction' : x === 'pet' ? 'pets welcome' : `a ${x}`);
  for (const x of p.near) bits.push(`near a ${x}`);
  if (!bits.length) return f.kind ? `Showing ${what}.` : 'Tell me beds, budget or what you want nearby.';
  return `Looking for ${what}: ${bits.join(', ')}.`;
}

// Template narration with several phrasings, used when the LLM is off or slow.
export function narrate(l, seed = 0) {
  const v = l.vexcel || {};
  const price = l.price != null ? shortMoney(l.price) : l.rent != null ? `${shortMoney(l.rent)} a month` : null;
  const beds = l.beds != null ? `${l.beds} bedroom` : '';
  const kind = l.kind === 'apartments' ? 'apartment community' : l.kind === 'rent' ? 'rental' : 'home';
  const firsts = [
    () => `Here it is: a ${beds} ${kind}${l.sqft ? ` with ${Number(l.sqft).toLocaleString('en-US')} square feet` : ''}${price ? `, ${l.kind === 'sold' ? 'last listed at' : 'asking'} ${price}` : ''}.`,
    () => `You have arrived at this ${beds} ${kind}${price ? ` for ${price}` : ''}${l.yearBuilt ? `, built in ${l.yearBuilt}` : ''}.`,
    () => `This is the one. ${beds ? beds.charAt(0).toUpperCase() + beds.slice(1) + 's' : 'Space'}${l.baths ? `, ${l.baths} baths` : ''}${price ? `, and it is ${price}` : ''}.`,
  ];
  if (l.kind === 'apartments') firsts.length = 0, firsts.push(() => `This is ${l.name || 'the community'}${price ? `, with rents from ${price}` : ''}${l.unitsAvailable ? ` and ${l.unitsAvailable} units open now` : ''}.`);
  const facts = [];
  if (v.poolDetected && l.listingPool === false) facts.push('The listing does not mention a pool, but there is one in the backyard');
  else if (v.poolDetected) facts.push('From the air you can see the pool out back');
  if (v.solar) facts.push('there are solar panels on the roof');
  if (v.treeCoverPct >= 25) facts.push(`trees cover about ${v.treeCoverPct} percent of the lot`);
  const near = l.nearby || {};
  if (near.park != null && near.park <= 500) facts.push(`a park is about ${Math.max(50, Math.round(near.park / 50) * 50)} meters away`);
  else if (near.school != null && near.school <= 500) facts.push(`a school is about ${Math.max(50, Math.round(near.school / 50) * 50)} meters away`);
  const hl = (l.highlights || []).filter((h) => h.length < 48).slice(0, 2);
  let second = '';
  if (facts.length) second = facts.slice(0, 2).join(', and ') + '.';
  else if (hl.length) second = `Highlights: ${hl.join(', and ')}.`;
  else second = 'Pull up and take a look inside.';
  second = second.charAt(0).toUpperCase() + second.slice(1);
  const first = firsts[Math.abs(seed) % firsts.length]().replace(/\s+/g, ' ').replace(' ,', ',');
  return `${first} ${second}`;
}
