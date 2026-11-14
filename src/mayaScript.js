// Maya without the model: scripted lines built from the same tools and insight data. Used
// when the LLM is off, the server is unreachable or a call fails, so she never goes silent.
// Returns { text, actions: [{name, input}], tools: [names], offered }.
import { pitch, label } from './mayaTools.js';

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const join = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

// questions about people, not places: answered with facts about the place instead
export const PEOPLE_RE = /\b(safe|unsafe|safety|crime|dangerous|sketchy|who lives|what kind of people|kind of people|neighbors like|demographic|race|racial|ethnic|white|black|hispanic|latino|asian|religio|church|mosque|synagogue|families|family friendly|kids|children|good (area|neighborhood|part)|bad (area|neighborhood|part)|rich|poor|gay|immigrants?|people like me|good schools?|best schools?|school ratings?)\b/i;

// what the player said they want, as short chips
export function extractPrefs(text) {
  const t = text.toLowerCase(), out = [];
  let m = /(?:under|below|budget(?: of| is)?|max(?:imum)?|up to|around)\s*\$?\s*([\d,.]+)\s*(k|m|million|thousand)?/.exec(t);
  if (m) { let v = parseFloat(m[1].replace(/,/g, '')); if (/m/.test(m[2] || '')) v *= 1e6; else if (/k|thousand/.test(m[2] || '') || v < 5000) v *= 1e3; if (v >= 50000) out.push({ key: 'budget', text: `budget ${v >= 1e6 ? '$' + v / 1e6 + 'M' : '$' + Math.round(v / 1e3) + 'K'}`, maxPrice: v }); else if (v >= 500) out.push({ key: 'monthly', text: `up to ${usd(v)} a month`, maxMonthly: v }); }
  m = /(\d|one|two|three|four|five)\s*(?:\+\s*)?(?:bed|br\b|bedroom)/.exec(t);
  if (m) { const n = { one: 1, two: 2, three: 3, four: 4, five: 5 }[m[1]] || Number(m[1]); out.push({ key: 'beds', text: `${n}+ beds`, minBeds: n }); }
  if (/\bpool\b/.test(t) && !/no pool/.test(t)) out.push({ key: 'pool', text: 'wants a pool', pool: true });
  if (/\b(yard|garden|outdoor space|park)\b/.test(t)) out.push({ key: 'outdoors', text: /park/.test(t) ? 'near a park' : 'wants a yard', outdoors: true });
  if (/\b(work|office|job)\b.*\b(downtown|near|at|in)\b/.test(t)) out.push({ key: 'commute', text: /downtown/.test(t) ? 'works downtown' : 'short commute', commute: true });
  if (/\b(rent|renting|lease)\b/.test(t) && !/rent or buy|vs/.test(t)) out.push({ key: 'kind', text: 'renting', kind: 'rent' });
  if (/\bsolar\b/.test(t)) out.push({ key: 'solar', text: 'wants solar', solar: true });
  if (/\b(low|no) hoa\b/.test(t)) out.push({ key: 'hoa', text: 'low HOA', lowHoa: true });
  return out;
}
export function prioritiesFrom(prefs, text = '') {
  const p = {};
  for (const x of prefs) for (const k of ['maxPrice', 'maxMonthly', 'minBeds', 'pool', 'outdoors', 'commute', 'kind', 'solar', 'lowHoa']) if (x[k] != null) p[k] = x[k];
  const t = text.toLowerCase();
  if (/cheaper|less|afford|budget|lower/.test(t)) p.budget = true;
  if (/bigger|larger|more space|more room/.test(t)) p.bigger = true;
  if (/value|deal/.test(t)) p.value = true;
  if (/risk|flood|safer from/.test(t)) p.lowRisk = true;
  if (/park|yard|outdoor/.test(t)) p.outdoors = true;
  if (/commute|downtown|closer/.test(t)) p.commute = true;
  if (/solar|electric|power bill/.test(t)) p.solar = true;
  if (/hoa/.test(t)) p.lowHoa = true;
  if (/pool/.test(t)) p.pool = true;
  if (!Object.keys(p).some((k) => p[k] === true)) { p.value = true; p.budget = true; }
  return p;
}

export async function scripted(text, S, T, extra = {}) {
  const t = text.toLowerCase();
  const l = S.selected, actions = [], tools = [];
  const say = (line, o = {}) => ({ text: line, actions, tools, ...o });
  const home = l ? T.alias(l.id) : null;

  // yes to "want me to take you?"
  if (S.offered && /^(yes|yeah|yep|sure|ok|okay|let'?s go|take me|go|do it|please)\b/.test(t.trim())) {
    actions.push({ name: 'start_route', input: { id: String(S.offered.id) } });
    tools.push('start_route');
    return say('On it. Follow the gold line, I will meet you there.');
  }
  if (PEOPLE_RE.test(t)) {
    if (!l) return say("I can't speak to who lives somewhere. I can tell you about a place: parks, shops and schools nearby, the commute, FEMA hazard and flood facts, prices. Select a home and ask me.");
    const p = await T.get_property({ home });
    tools.push('get_property');
    const bits = [];
    if (/school|kid|child|famil/.test(t) && p.nearest.school) bits.push(`the nearest school, ${p.nearest.school.name}, is a ${p.nearest.school.walkMin} minute walk`);
    if (p.nearest.park) bits.push(`${p.nearest.park.name} is ${p.nearest.park.walkMin} minutes on foot`);
    if (p.risk?.femaRating) bits.push(`FEMA rates natural hazard risk here ${p.risk.femaRating.toLowerCase()}`);
    if (p.noise.highwayMeters != null) bits.push(`the nearest highway is ${p.noise.highwayMeters} meters away`);
    actions.push({ name: 'show_card', input: { cardName: /school|kid|child/.test(t) ? 'schools' : /safe|crime|danger/.test(t) ? 'risk' : 'errands' } });
    return say(`I can't speak to who lives somewhere${/safe|crime|danger/.test(t) ? ", and I don't have crime data. The local police department's public crime map is the place to check" : ''}. Here is what I can tell you about the place: ${join(bits.slice(0, 3))}. What matters most to you day to day?`);
  }
  if (/\b(better|alternative|other option|something else|instead|cheaper|bigger|larger|different|similar)\b/.test(t)) {
    const r = await T.find_alternatives({ home, priorities: prioritiesFrom(S.prefs || [], t) }, extra);
    tools.push('find_alternatives');
    if (!r.alternatives.length) return say('Nothing else in this neighborhood fits that better. Want me to loosen one of your must haves?');
    const a = r.alternatives[0], al = T.resolve(a.home);
    actions.push({ name: 'alternatives', input: { ids: r.alternatives.map((x) => String(T.resolve(x.home).id)), why: r.alternatives.map((x) => x.betterBecause) } });
    return say(`I'd look at the ${a.label}: ${join(a.betterBecause.slice(0, 2))}. Want me to take you? It's about ${a.driveMinFromCurrentEstimate ?? 3} minutes away.`, { offered: al });
  }
  if (/\b(afford|my income|i make|i earn|salary)\b/.test(t)) {
    const m = /(\d[\d,.]*)\s*(k|thousand)?/.exec(t.replace(/\$/g, ''));
    let income = m ? parseFloat(m[1].replace(/,/g, '')) * (m[2] || parseFloat(m[1]) < 1000 ? 1000 : 1) : 0;
    if (income && income < 20000) income = 0;
    const r = await T.affordability_check({ home, yearlyIncome: income || undefined }, extra);
    tools.push('affordability_check');
    if (r.error) return say('Tell me your yearly income, or press P to fill in your profile, and I will check it against the usual 28 percent guideline.');
    if (income) actions.push({ name: 'set_profile', input: { income } });
    actions.push({ name: 'show_card', input: { cardName: 'cost' } });
    const th = r.thisHome;
    return say(`By the 28 percent guideline you are comfortable up to about ${usd(r.comfortableMonthly)} a month, roughly a ${usd(r.comfortablePrice)} home. ${th ? (th.fit === 'comfortable' ? `This one is about ${usd(th.difference)} under that.` : th.fit === 'stretch' ? `This one is a stretch at ${usd(th.monthly)}.` : `This one runs ${usd(th.monthly)}, over that range.`) : ''} That is a guideline, not advice.`);
  }
  if (/\bmy (work|office|job|gym|school|place)\b.*\b(is|near|at|on|in)\b/.test(t)) {
    const m = /my (work|office|job|gym|school|place)\b.*?\b(?:is|near|at|on|in)\b\s*(?:near|at|on|in)?\s*(.+)$/.exec(t);
    if (m && m[2]) { actions.push({ name: 'pin_place', input: { name: cap(m[1] === 'job' || m[1] === 'office' ? 'work' : m[1]), where: m[2].replace(/[.?!]+$/, '') } }); tools.push('pin_place'); return say(`Got it. I'm pinning your ${m[1]} near ${m[2].replace(/[.?!]+$/, '')}, and I'll show the drive from every home.`); }
  }
  if (/\b(find|show|search|looking for)\b/.test(t) && (!l || /\b(under|bed|pool|near|with)\b/.test(t))) {
    actions.push({ name: 'set_filters', input: { query: text } });
    tools.push('set_filters');
    return say('Let me light up the homes that match.');
  }
  if (/\b(mission|client|inbox|job for me)\b/.test(t)) { actions.push({ name: 'start_mission', input: {} }); tools.push('start_mission'); return say('I have clients waiting. Opening your inbox.'); }
  if (/\bcompare\b/.test(t)) { actions.push({ name: 'open_compare', input: {} }); tools.push('open_compare'); return say('Here are your saved homes side by side.'); }
  if (!l) return say('Pull up to a home or click one on the map, and I will tell you what the listing does not. Or tell me what you are looking for.');

  const p = await T.get_property({ home });
  tools.push('get_property');
  const card = (name) => actions.push({ name: 'show_card', input: { cardName: name } });
  const c = p.monthlyCostEstimate, v = p.value;
  const parts = [];
  const deal = /\b(deal|worth|overpriced|price|value|fair|negotiat)\b/.test(t), month = /\b(month|monthly|payment|pay|cost|mortgage)\b/.test(t);
  if (deal) {
    card('value');
    if (v && v.similarHomesCompared >= 3) parts.push(`At ${usd(v.pricePerSqft)} a square foot it is priced lower than ${v.pricedLowerThanPct} percent of ${v.similarHomesCompared} similar homes nearby, where the middle is ${usd(v.medianNearby)}.${p.priceNote ? ' Keep in mind Texas only shows asking prices.' : ''}`);
    else parts.push(p.apartment ? `Rents start at ${usd(p.apartment.rentFrom || 0)} a month.` : 'There are not enough similar homes nearby for a fair comparison.');
  }
  if (month) {
    tools.push('monthly_cost');
    if (c) { setTimeout(() => card('cost'), deal ? 2500 : 0); parts.push(`With 20 percent down you would pay about ${usd(c.total)} a month, as an estimate: ${usd(c.loanPayment)} for the loan, ${usd(c.propertyTax)} tax, ${usd(c.insuranceStateAverage)} insurance${c.hoa ? `, ${usd(c.hoa)} HOA` : ''} and ${usd(c.electric)} electric.${p.rentingSimilarNearby ? ` Renting a similar ${p.rentingSimilarNearby.beds} bed nearby is about ${usd(p.rentingSimilarNearby.medianRent)}.` : ''}`); } else if (p.rentFrom) { card('rent'); parts.push(`Rent starts at ${usd(p.rentFrom)} a month.`); }
  }
  if (parts.length) return say(parts.join(' '));
  if (/\b(rent|renting)\b/.test(t) && p.rentingSimilarNearby) { card('cost'); return say(`A similar ${p.rentingSimilarNearby.beds} bed rents for about ${usd(p.rentingSimilarNearby.medianRent)} a month nearby${c ? `, against an estimated ${usd(c.total)} to own this one` : ''}.`); }
  if (/\b(solar|electric|power|energy|bill|roof)\b/.test(t)) { card('energy'); return say(`${p.energy ? `The electric bill is estimated at ${usd(p.energy.billMonthEstimate)} a month. ` : ''}${p.solar.panels ? `The roof fits about ${p.solar.panels} panels, which could cover ${p.solar.coversPctOfBill} percent of that and save an estimated ${usd(p.solar.savingsYearEstimate)} a year.` : p.solar.existingPanels ? 'There are already solar panels on the roof.' : `Solar is not an option here: ${String(p.solar.why || 'no estimate').toLowerCase()}.`}${p.aerial.roofConditionOf5 ? ` From the air the roof rates ${p.aerial.roofConditionOf5} out of 5.` : ''}`); }
  if (/\b(flood|risk|insurance|earthquake|hurricane|fire|wildfire|storm|tornado|hazard)\b/.test(t)) { card('risk'); const r = p.risk || {}; return say(`${r.femaRating ? `FEMA rates natural hazard risk here ${r.femaRating.toLowerCase()}${r.topHazards?.length ? ', mainly ' + join(r.topHazards.slice(0, 2).map((h) => h.toLowerCase())) : ''}. ` : ''}${r.floodZone ? r.floodZone + '.' : 'I have no flood map answer for this spot.'}${r.floodInsuranceLikelyRequired ? ' A lender will likely require flood insurance.' : ''} For a real premium, ask an insurer for a quote.`); }
  if (/\b(school)\b/.test(t)) { card('schools'); const s = p.nearest.school; return say(`${s ? `The nearest school is ${s.name}, a ${s.walkMin} minute walk.` : 'I do not see a school close by.'}${p.schoolsNamedInListing.length ? ` The listing names ${join(p.schoolsNamedInListing.slice(0, 3))}.` : ''} I only have distances, not ratings.`); }
  if (/\b(park|outdoor|yard|pool|tree|green)\b/.test(t)) { card('outdoors'); const s = p.nearest.park; return say(`${s ? `${s.name} is a ${s.walkMin} minute walk.` : 'I do not see a park close by.'} ${p.aerial.pool ? 'There is a pool, seen from the air.' : 'No pool shows from the air.'}${p.aerial.treeCoverPct != null ? ` Tree cover on the lot is ${p.aerial.treeCoverPct} percent.` : ''}`); }
  if (/\b(commute|downtown|drive|work|transit|bus|train|metro)\b/.test(t)) {
    card('errands');
    const mine = extra.places?.length ? await T.drive_to_my_places({ home }, extra) : null;
    return say(`${p.downtown ? `${p.downtown.name} is about a ${p.downtown.driveMinEstimate} minute drive, as an estimate.` : ''}${p.nearest.transit ? ` The nearest transit stop is ${p.nearest.transit.walkMin} minutes on foot.` : ''}${mine?.places ? ' ' + mine.places.map((x) => `${x.name} is about ${x.driveMinEstimate} minutes`).join(', ') + '.' : ' Tell me where you work and I will add that drive.'}`);
  }
  if (/\b(shop|restaurant|grocer|supermarket|coffee|cafe|walk|errand|gym|pharmacy)\b/.test(t)) { card('errands'); const s = p.nearest.supermarket; return say(`${s ? `${s.name} is a ${s.walkMin} minute walk for groceries.` : ''}${p.shopsWithin10MinWalk ? ` There are ${p.shopsWithin10MinWalk} shops and places to eat within ten minutes on foot.` : ''}${p.nearest.cafe ? ` Closest coffee is ${p.nearest.cafe.name}.` : ''}`); }
  if (/\b(noise|noisy|loud|quiet|highway|freeway|airport|traffic)\b/.test(t)) { card('noise'); const n = p.noise; return say(`I can give you distances, not decibels. ${n.highwayMeters != null ? `The nearest highway is ${n.highwayMeters} meters away. ` : ''}${n.railMeters != null ? `The nearest rail line is ${n.railMeters} meters. ` : ''}${n.airportKm != null ? `The airport is ${n.airportKm} kilometers.` : ''}`); }
  if (/\b(hoa|fee|amenit|included|include)\b/.test(t)) { card('hoa'); return say(p.hoa?.fee ? `The HOA fee is ${usd(p.hoa.fee)} a month.${p.hoa.covers?.[2] ? ' ' + p.hoa.covers[2] + '.' : ''}${p.communityAmenities.length ? ` The community has ${join(p.communityAmenities.slice(0, 3).map((x) => x.toLowerCase()))}.` : ''}` : p.apartment?.amenities?.length ? `Amenities include ${join(p.apartment.amenities.slice(0, 4).map((x) => String(x).toLowerCase()))}.` : 'No HOA fee is listed for this one.'); }
  if (/\b(other city|houston|los angeles|l\.?a\.?|same money)\b/.test(t)) {
    const r = await T.same_money_other_city({ home });
    tools.push('same_money_other_city');
    if (r.error || !r.sameMonthlyCostGets.length) return say('I could not find a match in the other city for that monthly cost.');
    const o = r.sameMonthlyCostGets[0];
    actions.push({ name: 'other_city', input: r });
    return say(`For about the same ${usd(r.thisHome.monthly)} a month, ${r.otherCity} gets you ${o.beds ?? 'a'} bedrooms and ${(o.sqft || 0).toLocaleString('en-US')} square feet${o.lotAcres ? ` on ${o.lotAcres.toFixed(2)} acres` : ''}. Here that buys ${r.thisHome.beds ?? 'a'} beds and ${(r.thisHome.sqft || 0).toLocaleString('en-US')} square feet.`);
  }
  if (/\b(sofa|couch|bed fit|fit|table|piano)\b/.test(t)) {
    const m = /(\d+(?:\.\d+)?)\s*(?:ft|foot|feet|')/.exec(t);
    const r = await T.room_fit({ home, itemLengthFt: m ? Number(m[1]) : 8, room: /bed/.test(t) ? 'bed' : 'living' });
    tools.push('room_fit');
    if (r.error) return say('I do not have room sizes for this one. Walk inside and use the tape measure, key R.');
    const rm = r.rooms[0];
    return say(`The ${rm.room.toLowerCase()} is about ${rm.areaSqft} square feet, so its long wall is roughly ${rm.longestWallFtEstimate} feet. ${rm.fits ? `Your ${r.item} piece should fit` : `A ${r.item} piece would be tight`}. That wall length is an estimate, so walk inside and check with the tape measure, key R.`);
  }
  // the pitch: three strongest points, one honest trade off, one question
  const ins = await T.__ins(l.id);
  const pt = ins ? pitch(ins, T.__row(l.id)) : { points: [], tradeoffs: [] };
  if (pt.points[0]) card(pt.points[0].card);
  const pts = pt.points.map((x) => x.text);
  const line = pts.length ? `Here's what stands out about this ${label(l, T.__row(l.id))}: ${cap(pts[0])}${pts[1] ? '. ' + cap(pts[1]) : ''}${pts[2] ? '. And ' + pts[2] : ''}.` : `This is a ${label(l, T.__row(l.id))}.`;
  const con = pt.tradeoffs[0] ? ` The trade off: ${pt.tradeoffs[0].text}.` : '';
  return say(`${line}${con} What matters most to you: monthly cost, space, or the commute?`, { pitch: true });
}
