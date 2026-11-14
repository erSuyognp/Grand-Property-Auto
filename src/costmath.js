// Money math shared by the game and the server (Maya's tools). Pure functions, no DOM.
// Everything here is an estimate, never advice: see docs/SCORES.md.

// Monthly cost of owning: 30 year fixed loan + tax + insurance + HOA + electric - solar.
export function monthlyCost({ price, ratePct, downPct = 20, taxYear = 0, insuranceYear = 0, hoa = 0, electric = 0, solarMonth = 0, solarOn = false }) {
  const loan = price * (1 - downPct / 100);
  const r = ratePct / 100 / 12;
  const mortgage = r ? (loan * r) / (1 - (1 + r) ** -360) : loan / 360;
  const parts = { mortgage: Math.round(mortgage), tax: Math.round((taxYear || 0) / 12), insurance: Math.round((insuranceYear || 0) / 12), hoa: Math.round(hoa || 0), electric: Math.round(electric || 0) };
  const solar = solarOn ? Math.round(solarMonth || 0) : 0;
  return { ...parts, solar: -solar, total: parts.mortgage + parts.tax + parts.insurance + parts.hoa + parts.electric - solar, downPct, down: Math.round(price * downPct / 100) };
}

// Cost of one home from its insight file, for a down payment and the solar switch.
export function costFor(ins, { downPct = 20, solarOn = false } = {}) {
  const c = ins && ins.cost;
  if (!c) return null;
  // property tax follows the price; the other parts are fixed
  return monthlyCost({ price: c.price, ratePct: c.ratePct, downPct, taxYear: c.taxYear, insuranceYear: c.insuranceYear, hoa: c.hoa, electric: c.electric, solarMonth: c.solarMonth, solarOn });
}

// "Can I afford it?": the common 28% / 36% guideline. Housing costs at most 28% of gross
// monthly income, and housing plus other debts at most 36%. Returns the monthly housing
// budget and the price it supports (a guideline, not advice).
export function affordability({ income = 0, debts = 0, savings = 0, target = 0 }, { ratePct, taxRatePct = 1.2, insuranceYear = 0 }) {
  const gross = income / 12;
  const front = gross * 0.28, back = gross * 0.36 - debts;
  let budget = Math.max(0, Math.min(front, back));
  const stretch = Math.max(0, Math.min(gross * 0.33, gross * 0.43 - debts));
  if (target > 0) budget = Math.min(budget, target);
  const priceFor = (monthly) => {
    const r = ratePct / 100 / 12;
    const k = r ? r / (1 - (1 + r) ** -360) : 1 / 360;
    const fixed = insuranceYear / 12;
    // monthly = (price - savings) * k + price * tax / 12 + fixed
    const price = (monthly - fixed + savings * k) / (k + taxRatePct / 100 / 12);
    return Math.max(0, Math.round(price / 1000) * 1000);
  };
  return { budget: Math.round(budget), stretch: Math.round(Math.max(stretch, budget)), maxPrice: priceFor(budget), stretchPrice: priceFor(Math.max(stretch, budget)), limitedBy: target > 0 && target <= Math.min(front, back) ? 'your target' : front <= back ? '28% of income' : '36% with debts' };
}

// comfortable | stretch | out, for one home's monthly cost against a profile result
export function affordTier(total, aff) {
  if (total == null || !aff || !aff.budget) return null;
  return total <= aff.budget ? 'comfortable' : total <= aff.stretch ? 'stretch' : 'out';
}

// Time estimates when no routing service is available: a route 1.3 times the straight line.
export const driveMin = (m) => Math.max(1, Math.round((m * 1.3) / ((25 * 1609.34) / 60)));
export const walkMin = (m) => Math.max(1, Math.round((m * 1.3) / 80));
