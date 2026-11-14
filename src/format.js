// Text helpers shared by the HUD, the phone page and narration.
export function money(v) {
  if (v == null) return '';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
  if (v >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v).toLocaleString('en-US');
}

export function priceText(l) {
  if (l.kind === 'apartments') return l.rent ? `${money(l.rent)}${l.rentMax && l.rentMax !== l.rent ? ' to ' + money(l.rentMax) : ''} /mo` : 'Call for rent';
  if (l.rent != null) return `${money(l.rent)} /mo`;
  return l.price != null ? money(l.price) : 'Price on request';
}

export function priceValue(l) {
  return l.kind === 'apartments' || l.price == null ? (l.rent || 0) : l.price;
}

export const KIND_LABEL = { sale: 'For sale', rent: 'For rent', apartments: 'Apartments', sold: 'Recently sold' };
export const KIND_COLOR = { sale: '#2fd46b', rent: '#3aa0ff', apartments: '#b46bff', sold: '#9aa3ad' };

export function factsText(l) {
  const out = [];
  if (l.beds != null) out.push(`${l.beds} bd`);
  if (l.baths != null) out.push(`${l.baths} ba`);
  if (l.sqft) out.push(`${Number(l.sqft).toLocaleString('en-US')} sqft`);
  if (l.kind === 'apartments' && l.unitsAvailable != null) out.push(`${l.unitsAvailable} units available`);
  return out.join(' · ');
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Badges built from what the aerial data sees, not from the listing text.
export function aerialBadges(l) {
  const v = l.vexcel || {};
  const out = [];
  if (v.poolDetected) out.push({ icon: 'pool', text: 'Pool seen from the air' });
  if (v.solar) out.push({ icon: 'solar', text: 'Solar roof' });
  if (v.treeCoverPct >= 15) out.push({ icon: 'tree', text: `${v.treeCoverPct}% tree cover` });
  const near = l.nearby || {};
  const order = [['park', 'Park'], ['school', 'School'], ['playground', 'Playground'], ['shopping center', 'Shops'], ['tennis court', 'Tennis'], ['water', 'Water']];
  let shown = 0;
  for (const [k, label] of order) {
    if (near[k] != null && near[k] <= 650 && shown < 2) { out.push({ icon: 'pin', text: `${label} ${Math.max(50, Math.round(near[k] / 50) * 50)} m away` }); shown++; }
  }
  if (v.roofMaterial && out.length < 5) out.push({ icon: 'roof', text: `${cap(v.roofMaterial)} roof` });
  return out;
}

// A plain object the phone page can render too.
export function cardData(l) {
  return {
    id: l.id, kind: l.kind, kindLabel: l.status || KIND_LABEL[l.kind], title: l.name || l.address, address: [l.address, l.city].filter(Boolean).join(', '),
    price: priceText(l), priceLabel: l.priceLabel || '', facts: factsText(l), highlights: (l.highlights || []).slice(0, 4),
    badges: aerialBadges(l).map((b) => b.text), canTour: (l.matterportIds || []).length > 0,
    floorPlans: (l.floorPlans || []).slice(0, 6).map((f) => ({ name: f.name, beds: f.beds, rent: f.rentMin ? `${money(f.rentMin)}${f.rentMax && f.rentMax !== f.rentMin ? ' to ' + money(f.rentMax) : ''}` : '', units: f.unitsAvailable })),
  };
}
