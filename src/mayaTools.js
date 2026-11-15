// Maya's tools: plain functions over the local insight files. The same code runs on the
// server (for the model's tool calls) and in the browser (for the scripted fallback), so both
// brains state the same facts. Nothing here calls outside the laptop.
//
// db = { city, listings, row(id), ins(id) -> Promise, other() -> Promise<{city, name, rows}> }
// Homes are named to the model by short aliases (h1, h2, ...) and described by numbers only:
// no street address, listing id, agent or tenant names.
import { costFor, monthlyCost, affordability, affordTier, driveMin, walkMin, typicalElectric } from './costmath.js';

const usd = (n) => (n == null ? null : '$' + Math.round(n).toLocaleString('en-US'));
const short = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1e4 ? '$' + Math.round(n / 1e3) + 'K' : usd(n));
const R = 6371000, rad = Math.PI / 180;
export function meters(a, b) {
  const s = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const KIND_WORD = { sale: 'for sale', sold: 'recently sold', rent: 'for rent', apartments: 'apartment community' };

export function label(l, row) {
  const beds = l.beds != null ? `${l.beds} bed ` : '';
  if (l.kind === 'apartments') return `apartment community${row?.rent ? ' from ' + usd(row.rent) + ' a month' : ''}`;
  if (l.rent != null && l.price == null) return `${beds}rental at ${usd(l.rent)} a month`;
  return `${beds}home at ${short(l.price)}`;
}

// The strongest real selling points and the honest trade offs of one home, from its data.
export function pitch(ins, row) {
  const pts = [], cons = [];
  const P = ins.places || {}, v = ins.value, c = ins.cost, r = ins.rentVsBuy, a = ins.aerial || {}, n = ins.noise || {};
  const first = (cat) => P[cat]?.[0];
  if (v && v.n >= 3 && v.lowerThanPct >= 55) pts.push({ w: v.lowerThanPct, card: 'value', text: `it's priced lower than ${v.lowerThanPct}% of similar homes nearby, at ${usd(v.ppsf)} a square foot` });
  if (v && v.n >= 3 && v.lowerThanPct <= 25) cons.push({ w: 100 - v.lowerThanPct, card: 'value', text: `it's priced higher per square foot than ${100 - v.lowerThanPct}% of similar homes nearby` });
  if (c && r && c.total <= r.medianRent * 1.05) pts.push({ w: 85, card: 'cost', text: `the estimated monthly cost of ${usd(c.total)} is close to what a similar ${r.beds} bed rents for nearby, ${usd(r.medianRent)}` });
  if (c && r && c.total > r.medianRent * 1.5) cons.push({ w: 60, card: 'cost', text: `owning it is an estimated ${usd(c.total)} a month, against about ${usd(r.medianRent)} to rent a similar ${r.beds} bed nearby` });
  if (ins.solar?.panels) pts.push({ w: 50 + Math.min(30, ins.solar.savingsYear / 100), card: 'energy', text: `the roof fits solar that could save an estimated ${usd(ins.solar.savingsYear)} a year` });
  if (a.pool) pts.push({ w: 70, card: 'outdoors', text: 'there is a pool, seen from the air' });
  const park = first('park'), sup = first('supermarket'), tr = first('transit');
  if (park && park.walkMin <= 6) pts.push({ w: 72 - park.walkMin * 2, card: 'outdoors', text: `${park.name} is a ${park.walkMin} minute walk` });
  if (sup && sup.walkMin <= 10) pts.push({ w: 70 - sup.walkMin * 2, card: 'errands', text: `${sup.name} is a ${sup.walkMin} minute walk for groceries` });
  if (tr && tr.walkMin <= 4) pts.push({ w: 52, card: 'errands', text: `a transit stop is ${tr.walkMin} minutes on foot` });
  const dt = ins.drive?.downtown;
  if (dt && dt.min <= 10) pts.push({ w: 66 - dt.min, card: 'errands', text: `${dt.name} is about a ${dt.min} minute drive, as an estimate` });
  if (dt && dt.min >= 25) cons.push({ w: 40, card: 'errands', text: `${dt.name} is about a ${dt.min} minute drive` });
  if (ins.activity?.shopsWalk >= 60) pts.push({ w: 55, card: 'activity', text: `${ins.activity.shopsWalk} shops and places to eat are within a 10 minute walk` });
  if (ins.risk?.tier === 'lower') pts.push({ w: 58, card: 'risk', text: 'FEMA rates natural hazard risk here on the lower side' });
  if (ins.risk?.flood?.sfha) cons.push({ w: 95, card: 'risk', text: `it sits in a high risk flood zone (${ins.risk.flood.zone}), so a lender will likely require flood insurance` });
  else if (ins.risk?.tier === 'higher') cons.push({ w: 55, card: 'risk', text: `FEMA rates natural hazard risk here ${String(ins.risk.nri?.rating || 'higher').toLowerCase()}${ins.risk.nri?.top?.[0] ? ', mostly ' + ins.risk.nri.top[0].hazard.toLowerCase() : ''}, which can push insurance up` });
  if (a.roofCondition >= 4) pts.push({ w: 45, card: 'energy', text: `the roof looks in good shape from the air, ${a.roofCondition} out of 5` });
  if (a.roofCondition && a.roofCondition <= 2) cons.push({ w: 58, card: 'energy', text: `the roof rates ${a.roofCondition} out of 5 from the air, so budget for an inspection` });
  if (c && !c.hoa) pts.push({ w: 30, card: 'hoa', text: 'there is no HOA fee listed' });
  const amen = amenityList(ins);
  if (amen.length >= 2) pts.push({ w: 60, card: 'hoa', text: `${ins.apartment ? 'amenities include' : 'the listing names community features like'} ${amen.slice(0, 3).map((x) => String(x).toLowerCase()).join(', ')}` });
  if (c && c.hoa >= 400) cons.push({ w: 50 + Math.min(40, c.hoa / 50), card: 'hoa', text: `the HOA fee is ${usd(c.hoa)} a month` });
  if (ins.energy && ins.energy.billMonth >= 260) cons.push({ w: 45, card: 'energy', text: `the electric bill is estimated at ${usd(ins.energy.billMonth)} a month` });
  if (n.highway && n.highway.distM < 250) cons.push({ w: 52, card: 'noise', text: `a highway is ${n.highway.distM} meters away` });
  if (n.rail && n.rail.distM < 150) cons.push({ w: 50, card: 'noise', text: `a rail line is ${n.rail.distM} meters away` });
  const cut = (ins.home?.priceHistory || []).filter((h) => h.to < h.from).pop();
  if (cut) pts.push({ w: 48, card: 'value', text: `the price was cut by ${short(cut.from - cut.to)}` });
  if (ins.facts?.daysOnMarket > 120) cons.push({ w: 35, card: 'value', text: `it has been on the market ${ins.facts.daysOnMarket} days, which may mean room to negotiate or a reason buyers passed` });
  if (ins.apartment?.unitsAvailable) pts.push({ w: 40, card: 'rent', text: `${ins.apartment.unitsAvailable} homes are available now` });
  pts.sort((x, y) => y.w - x.w); cons.sort((x, y) => y.w - x.w);
  return { points: pts.slice(0, 3), tradeoffs: cons.slice(0, 2) };
}

// Amenities worth saying aloud: the listing's community section also holds the subdivision
// name, the builder and pet rules, which are not amenities.
export const amenityList = (ins) => (ins?.apartment ? ins.apartment.amenities || [] : ins?.home?.community || []).filter((x) => x && String(x).length <= 32 && !/subdivision|\bsubd?\b|\baddition\b|\bsection\b|\bphase\b|built by|call for|\bpets?\b|deposit|\brules?\b/i.test(String(x)));

// The money and paperwork side of a home as short spoken sentences: insurance, hazard risk,
// HOA, amenities, tax, energy. The reveal and the guided tour use these so the story is not
// only about what is nearby. Calculated numbers say "estimated"; missing data is skipped.
export function extraFacts(ins) {
  if (!ins) return [];
  const out = [], h = ins.home || {}, c = ins.cost, r = ins.risk, list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const low = (a) => a.map((x) => String(x).toLowerCase());
  if (c?.insurance) out.push({ key: 'insurance', card: 'cost', title: 'Insurance', text: `Home insurance is estimated at about ${usd(c.insurance)} a month, from the state average. A quote from an insurer is the real number.` });
  if (r?.nri?.rating || r?.flood) {
    const top = (r.nri?.top || []).slice(0, 2).map((x) => x.hazard.toLowerCase());
    out.push({ key: 'risk', card: 'risk', title: 'Risk', text: `${r.nri?.rating ? `FEMA rates natural hazard risk here ${r.nri.rating.toLowerCase()}${top.length ? ', mainly ' + list(top) : ''}. ` : ''}${r.flood?.sfha ? 'It is in a high risk flood zone, so a lender will likely require flood insurance.' : r.flood?.label ? r.flood.label + '.' : ''}`.trim() });
  }
  const covers = (h.hoa?.lines || []).map((x) => (/include/i.test(x) ? x.replace(/^.*?include[s]?\s*/i, '').split(/,\s*/) : [])).flat().filter(Boolean);
  if (h.hoa?.fee) out.push({ key: 'hoa', card: 'hoa', title: 'HOA', text: `The HOA fee is ${usd(h.hoa.fee)} a month${covers.length ? `, and it covers ${list(low(covers.slice(0, 3)))}` : '. The listing does not say what it covers'}.` });
  else if (c && !c.hoa && !ins.apartment) out.push({ key: 'hoa', card: 'hoa', title: 'HOA', text: 'There is no HOA fee listed for this home.' });
  const amen = amenityList(ins);
  if (amen.length) out.push({ key: 'amenities', card: 'hoa', title: 'Amenities', text: `${ins.apartment ? 'Amenities here include' : 'Community features in the listing:'} ${list(low(amen.slice(0, 4)))}.` });
  if (c?.tax) out.push({ key: 'tax', card: 'cost', title: 'Property tax', text: `Property tax is estimated at about ${usd(c.tax)} a month.` });
  if (ins.energy?.billMonth) out.push({ key: 'energy', card: 'energy', title: 'Energy', text: `The electric bill is estimated at about ${usd(ins.energy.billMonth)} a month${ins.solar?.panels ? `, and rooftop solar could save an estimated ${usd(ins.solar.savingsYear)} a year` : ''}.` });
  return out;
}

export function makeTools(db) {
  const alias = (id) => 'h' + (db.listings.findIndex((l) => String(l.id) === String(id)) + 1);
  const resolve = (ref) => {
    if (ref == null) return null;
    const m = /^h(\d+)$/i.exec(String(ref).trim());
    return m ? db.listings[Number(m[1]) - 1] || null : db.listings.find((l) => String(l.id) === String(ref)) || null;
  };
  const brief = (l) => {
    const row = db.row(l.id) || {};
    return { home: alias(l.id), label: label(l, row), kind: KIND_WORD[l.kind], price: l.price ?? null, rentFrom: row.rent ?? null, beds: l.beds ?? null, baths: l.baths ?? null, sqft: l.sqft || null,
      estimatedMonthlyCost: row.cost ?? null, pricedLowerThanPctOfSimilar: row.lowerThanPct ?? null, electricBillEstimate: row.bill ?? null, solarSavingsYearEstimate: row.solarSave ?? null,
      poolSeenFromAir: !!row.pool, hoaMonthly: l.hoa ?? null, parkWalkMin: row.parkWalk ?? null, supermarketDriveMin: row.superDrive ?? null, downtownDriveMinEstimate: row.downtownMin ?? null,
      transitWalkMin: row.transitWalk ?? null, floodZone: row.floodZone ?? null, hazardRisk: row.riskTier ?? null, shopsWithin10MinWalk: row.shopsWalk ?? null, has3dTour: (l.matterportIds || []).length > 0, scores: row.scores || {} };
  };

  async function get_property({ home }) {
    const l = resolve(home);
    if (!l) return { error: 'No such home' };
    const ins = await db.ins(l.id);
    if (!ins) return { ...brief(l), note: 'No insight data for this home' };
    const p = pitch(ins, db.row(l.id));
    const place = (cat) => { const x = ins.places?.[cat]?.[0]; return x ? { name: x.name, walkMin: x.walkMin, driveMinEstimate: x.driveMin } : null; };
    return {
      ...brief(l), yearBuilt: l.yearBuilt ?? null, lotAcres: l.lotAcres ?? null, type: ins.facts?.type ?? null, daysOnMarket: ins.facts?.daysOnMarket ?? null,
      priceNote: ins.facts?.askingOnly ? 'Texas does not disclose sale prices: this is the last asking price' : null,
      strongestPoints: p.points.map((x) => x.text), tradeoffs: p.tradeoffs.map((x) => x.text),
      value: ins.value ? { pricePerSqft: ins.value.ppsf, medianNearby: ins.value.medianPpsf, similarHomesCompared: ins.value.n, pricedLowerThanPct: ins.value.lowerThanPct, withinKm: ins.value.radiusKm } : null,
      monthlyCostEstimate: ins.cost ? { total: ins.cost.total, loanPayment: ins.cost.mortgage, propertyTax: ins.cost.tax, insuranceStateAverage: ins.cost.insurance, hoa: ins.cost.hoa, electric: ins.cost.electric, downPaymentPct: 20, ratePct: ins.cost.ratePct, note: 'Estimate, not advice' } : null,
      rentingSimilarNearby: ins.rentVsBuy ? { beds: ins.rentVsBuy.beds, medianRent: ins.rentVsBuy.medianRent } : null,
      apartment: ins.apartment ? { rentFrom: ins.apartment.rentMin, rentTo: ins.apartment.rentMax, unitsAvailable: ins.apartment.unitsAvailable, amenities: (ins.apartment.amenities || []).slice(0, 8), floorPlans: (ins.apartment.plans || []).slice(0, 6).map((f) => ({ beds: f.beds, sqft: f.sqft, rentFrom: f.rentMin })) } : null,
      energy: ins.energy ? { billMonthEstimate: ins.energy.billMonth, kwhYear: ins.energy.kwhYear } : null,
      solar: ins.solar?.panels ? { panels: ins.solar.panels, coversPctOfBill: ins.solar.coverPct, savingsYearEstimate: ins.solar.savingsYear } : { available: false, why: ins.solar?.why, existingPanels: !!ins.solar?.existing },
      risk: ins.risk ? { femaRating: ins.risk.nri?.rating ?? null, topHazards: (ins.risk.nri?.top || []).map((h) => h.hazard), floodZone: ins.risk.flood?.label ?? null, floodInsuranceLikelyRequired: !!ins.risk.flood?.sfha, insurancePressure: ins.risk.tier } : null,
      nearest: { supermarket: place('supermarket'), park: place('park'), school: place('school'), transit: place('transit'), gym: place('gym'), pharmacy: place('pharmacy'), cafe: place('cafe'), hospital: place('hospital') },
      downtown: ins.drive?.downtown ? { name: ins.drive.downtown.name, driveMinEstimate: ins.drive.downtown.min } : null,
      noise: { highwayMeters: ins.noise?.highway?.distM ?? null, railMeters: ins.noise?.rail?.distM ?? null, airportKm: ins.noise?.airport ? Math.round(ins.noise.airport.distM / 1000) : null },
      aerial: { pool: !!ins.aerial?.pool, treeCoverPct: ins.aerial?.treeCoverPct ?? null, roofMaterial: ins.aerial?.roofMaterial ?? null, roofConditionOf5: ins.aerial?.roofCondition ?? null, solarPanelsOnRoof: !!ins.aerial?.solar },
      hoa: ins.home?.hoa ? { fee: ins.home.hoa.fee, covers: ins.home.hoa.lines } : null, communityAmenities: (ins.home?.community || []).slice(0, 8), listingHighlights: (ins.home?.highlights || []).slice(0, 8),
      schoolsNamedInListing: ins.home?.schools || [], neighborhoodActivity: ins.activity?.facts || [],
      areaFacts: ins.census ? { medianHouseholdIncome: ins.census.income, cityMedianHouseholdIncome: ins.census.city?.income ?? null, source: 'Census ACS' } : null,
      scoreReasons: Object.fromEntries(Object.entries(ins.scores || {}).map(([k, s]) => [k, s.reason])),
    };
  }

  async function compare({ homeA, homeB }) {
    const a = resolve(homeA), b = resolve(homeB);
    if (!a || !b) return { error: 'No such home' };
    return { a: brief(a), b: brief(b), apartMeters: Math.round(meters(a, b)) };
  }

  // Rank the other homes by what the player asked for. Each priority is optional.
  async function find_alternatives({ home, priorities = {} }, extra = {}) {
    const cur = resolve(home);
    const p = { ...priorities };
    const curRow = cur ? db.row(cur.id) || {} : {};
    const wantRent = p.kind === 'rent' || (cur && cur.price == null && !p.kind);
    const pool = db.listings.filter((l) => l !== cur && (wantRent ? l.price == null : l.price != null) && (p.includeSold || l.kind !== 'sold' || !db.listings.some((x) => x.kind === 'sale')));
    const scored = [];
    for (const l of pool) {
      const row = db.row(l.id);
      if (!row) continue;
      const cost = wantRent ? row.rent : row.cost;
      if (p.maxPrice && l.price > p.maxPrice) continue;
      if (p.maxMonthly && cost && cost > p.maxMonthly) continue;
      if (p.minBeds && (l.beds ?? 0) < p.minBeds) continue;
      if (p.pool && !row.pool) continue;
      let s = 0;
      const why = [];
      const better = (cond, pts, text) => { if (cond) { s += pts; why.push(text); } };
      if (cur) {
        better(cost && (curRow.cost || curRow.rent) && cost < (curRow.cost || curRow.rent) * 0.95, p.budget || p.maxMonthly || p.maxPrice ? 30 : 14, `about ${usd((curRow.cost || curRow.rent) - cost)} a month less`);
        better(p.value && row.lowerThanPct != null && row.lowerThanPct > (curRow.lowerThanPct ?? 0) + 10, 26, `priced lower than ${row.lowerThanPct}% of similar homes`);
        better(p.outdoors && row.parkWalk != null && row.parkWalk < (curRow.parkWalk ?? 99), 22, `a park ${row.parkWalk} minutes on foot`);
        better(p.commute && row.downtownMin != null && row.downtownMin < (curRow.downtownMin ?? 99), 22, `${row.downtownMin} minutes to downtown`);
        better(p.solar && row.solarSave && row.solarSave > (curRow.solarSave || 0), 22, `solar could save ${usd(row.solarSave)} a year`);
        better(p.lowHoa && (l.hoa || 0) < (cur.hoa || 0), 22, l.hoa ? `HOA ${usd(l.hoa)} a month` : 'no HOA fee listed');
        better(p.lowRisk && (row.scores?.risk ?? 0) > (curRow.scores?.risk ?? 0) + 5, 22, `lower hazard risk`);
        better(p.bigger && (l.sqft || 0) > (cur.sqft || 0) * 1.08, 20, `${(l.sqft || 0).toLocaleString('en-US')} square feet`);
        better((l.beds ?? 0) > (cur.beds ?? 0) && p.minBeds, 8, `${l.beds} bedrooms`);
      }
      better(p.pool && row.pool, 25, 'a pool seen from the air');
      if (extra.places?.length) { // the player's own places
        const mins = extra.places.reduce((t, pl) => t + driveMin(meters(l, pl)), 0);
        const curMins = cur ? extra.places.reduce((t, pl) => t + driveMin(meters(cur, pl)), 0) : mins;
        better(mins < curMins, 18, `${curMins - mins} fewer minutes to your places`);
      }
      // a gentle default: overall fit from the scores
      const sc = row.scores || {};
      s += ((sc.value ?? 50) + (sc.errands ?? 50) + (sc.outdoors ?? 50) + (sc.risk ?? 50)) / 40;
      if (l.kind === 'sale' || l.kind === 'rent' || l.kind === 'apartments') s += 4;
      scored.push({ l, s, why });
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 3).map(({ l, why }) => ({ ...brief(l), betterBecause: why.length ? why.slice(0, 3) : ['a similar overall fit on value, errands and outdoors'], driveMinFromCurrentEstimate: cur ? driveMin(meters(cur, l)) : null }));
    return { comparedWith: cur ? alias(cur.id) : null, priorities: p, alternatives: top, note: top.length ? null : 'Nothing else in this area fits those priorities' };
  }

  async function nearby({ home, category }) {
    const l = resolve(home);
    const ins = l && (await db.ins(l.id));
    if (!ins) return { error: 'No data' };
    const cat = { grocery: 'supermarket', groceries: 'supermarket', coffee: 'cafe', restaurants: 'restaurant', bus: 'transit', train: 'transit', schools: 'school', parks: 'park' }[category] || category;
    const list = ins.places?.[cat];
    if (!list) return { error: `Unknown category. Use one of: ${Object.keys(ins.places || {}).join(', ')}` };
    return { category: cat, places: list.map((p) => ({ name: p.name, meters: p.distM, walkMin: p.walkMin, driveMinEstimate: p.driveMin })), note: 'Times are estimates from distance' };
  }

  async function monthly_cost({ home, downPaymentPct = 20, solar = false }) {
    const l = resolve(home);
    const ins = l && (await db.ins(l.id));
    if (!ins?.cost) return { error: 'This home has no purchase cost (it is a rental or has no price)' };
    const already = !!ins.solar?.existing;
    const c = costFor(ins, { downPct: downPaymentPct, solarOn: solar && !already });
    return { home: alias(l.id), total: c.total, loanPayment: c.mortgage, propertyTax: c.tax, insuranceStateAverage: c.insurance, hoa: c.hoa, electric: c.electric, solarSavings: -c.solar, downPayment: c.down, downPaymentPct,
      ratePct: ins.cost.ratePct, rentingSimilarNearby: ins.rentVsBuy?.medianRent ?? null, note: `${already && solar ? 'Panels are already on the roof, so this does not subtract a second solar saving. ' : ''}Estimate, not financial advice. Mortgage insurance for down payments under 20% is not included.` };
  }

  // "Can I afford it?": the 28% / 36% guideline
  async function affordability_check({ home, yearlyIncome, monthlyDebts = 0, savings = 0, targetMonthly = 0 }, extra = {}) {
    const prof = yearlyIncome ? { income: yearlyIncome, debts: monthlyDebts, savings, target: targetMonthly } : extra.profile;
    if (!prof?.income) return { error: 'Ask the player for their yearly income first (and monthly debts, savings for a down payment if they want)' };
    const money = db.money || {};
    const aff = affordability(prof, { ratePct: money.rate?.rate || 7, taxRatePct: money.taxRatePct || 1.2, insuranceYear: money.insurance?.homeowners || 0, electricMonth: typicalElectric(money) });
    const l = resolve(home);
    const row = l ? db.row(l.id) : null;
    const total = row ? row.cost ?? row.rent : null;
    return { guideline: '28% of income for housing, 36% with other debts. A guideline, not advice.', comfortableMonthly: aff.budget, stretchMonthly: aff.stretch, comfortablePrice: aff.maxPrice,
      thisHome: l && total ? { home: alias(l.id), monthly: total, fit: affordTier(total, aff), difference: aff.budget - total } : null,
      homesInComfortableRange: db.listings.filter((x) => { const r = db.row(x.id); const t = r && (r.cost ?? r.rent); return t && t <= aff.budget; }).length };
  }

  async function drive_to_my_places({ home }, extra = {}) {
    const l = resolve(home);
    if (!l) return { error: 'No such home' };
    if (!extra.places?.length) return { error: 'The player has not pinned any places yet. Offer to pin one, for example their work.' };
    return { home: alias(l.id), places: extra.places.map((p) => ({ name: p.name, driveMinEstimate: driveMin(meters(l, p)), walkMin: walkMin(meters(l, p)) })), note: 'Estimates from distance at 25 mph' };
  }

  async function room_fit({ home, itemLengthFt, room }) {
    const l = resolve(home);
    const rooms = l && db.rooms ? await db.rooms(l) : null;
    if (!rooms?.length) return { error: 'Room sizes are not available for this home' };
    const want = (room || 'living').toLowerCase();
    const list = rooms.filter((r) => r.label.toLowerCase().includes(want));
    const use = (list.length ? list : rooms).slice(0, 4);
    return { item: `${itemLengthFt} ft`, rooms: use.map((r) => ({ room: r.label, areaSqft: r.areaSqft, longestWallFtEstimate: r.longFt, fits: r.longFt ? r.longFt >= itemLengthFt + 1 : null })), note: 'Room sizes come from the 3D scan. The wall length is an estimate from the room area; use the tape measure inside (key R) to check.' };
  }

  async function same_money_other_city({ home }) {
    const l = resolve(home);
    const row = l && db.row(l.id);
    const total = row && (row.cost ?? row.rent);
    if (!total || !db.other) return { error: 'Not available' };
    const o = await db.other();
    if (!o?.rows?.length) return { error: 'No data for the other city' };
    const own = row.cost != null;
    const fits = o.rows.filter((r) => (own ? r.cost : r.rent) && Math.abs((own ? r.cost : r.rent) - total) / total <= 0.12).sort((a, b) => (b.sqft || 0) - (a.sqft || 0)).slice(0, 3);
    return { thisHome: { monthly: total, beds: l.beds ?? null, sqft: l.sqft || null, lotAcres: l.lotAcres ?? null }, otherCity: o.name,
      sameMonthlyCostGets: fits.map((r) => ({ monthly: own ? r.cost : r.rent, price: r.price ?? null, beds: r.beds, sqft: r.sqft, lotAcres: r.lotAcres ?? null, poolSeenFromAir: !!r.pool })), note: fits.length ? 'Estimates' : `Nothing in ${o.name} within 12% of that monthly cost` };
  }

  return { alias, resolve, brief, get_property, compare, find_alternatives, nearby, monthly_cost, affordability_check, drive_to_my_places, room_fit, same_money_other_city };
}

// Tools the game itself carries out (the server only passes them through).
export const CLIENT_TOOLS = ['start_route', 'set_filters', 'show_on_map', 'start_mission', 'show_card', 'remember_preference', 'pin_place', 'open_compare', 'fast_travel', 'set_sun_time', 'print_shortlist', 'measure'];
