// The same thing, said a different way each time. Two jobs, shared by the browser and the server:
//
//   pick(slot, options)      one of several stock phrasings, never the one used last time for
//                            that slot (remembered across page loads, so two demos in a row
//                            do not open with the same sentence)
//   keepsFacts(stock, said)  the check a line written by the model must pass before Maya says
//                            it: same numbers, same names, same hedges, no banned wording
//
// A model written line that fails the check is dropped and the stock line is said instead, so
// nothing Maya says can carry a number the data did not give.

let memory = null;
function recall() {
  if (memory) return memory;
  memory = {};
  try { memory = JSON.parse(globalThis.localStorage?.getItem('gpa-lines') || '{}') || {}; } catch { /* the server, or private mode */ }
  return memory;
}
function keep() {
  try { globalThis.localStorage?.setItem('gpa-lines', JSON.stringify(memory)); } catch { /* the server, or private mode */ }
}

export function pick(slot, options) {
  const list = options.filter((x) => x != null && x !== '');
  if (!list.length) return '';
  const mem = recall();
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === mem[slot]) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  mem[slot] = i;
  keep();
  const v = list[i];
  return typeof v === 'function' ? v() : v;
}

// The words that link one line of a story to the next ("Next,", "Then", "And"), so a run of
// lines does not open the same way. One flow per story: lead() picks a link it has not used in
// its last few lines, and sometimes none at all.
export function makeFlow() {
  const used = [];
  return {
    lead(options, skip = 0.25) {
      if (Math.random() < skip) return '';
      const fresh = options.filter((o) => !used.includes(o));
      const pool = fresh.length ? fresh : options;
      const o = pool[Math.floor(Math.random() * pool.length)];
      used.push(o);
      while (used.length > 3) used.shift();
      return o;
    },
  };
}

// the numbers a sentence states, as plain values: "$1,840" 1840, "$708K" 708000, "22%" 22
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*(?:k|m|million|thousand)\b)?/gi)) {
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] || '').trim().toLowerCase();
    if (unit === 'k' || unit === 'thousand') v *= 1e3; else if (unit === 'm' || unit === 'million') v *= 1e6;
    out.add(Math.round(v * 1000) / 1000);
  }
  return out;
}

const HEDGE = /\b(about|around|roughly|approximately|estimate[sd]?|or so|close to|likely)\b/i;
// Wording the fair housing rules of this game do not allow in anything Maya says (CLAUDE.md
// rules 5 to 8), plus opinions about schools. Used only to reject a line, never shown.
export const UNFAIR_RE = /\b(safe|unsafe|safer|safest|good neighbou?rhood|bad area|exclusive|family[- ]friendly|kid[- ]friendly|rich|poor|up[- ]and[- ]coming|right kind of people|affluent|wealthy|upscale|desirable|sketchy|(?:great|good|best|top|excellent|bad|poor)[- ](?:schools?|district))\b/i;

const TOPICS = [/\bHOA\b/i, /\bflood/i, /\bFEMA\b/i, /\bsolar\b/i, /\binsur/i, /\btax/i, /\bcensus\b/i, /\bincome\b/i, /\bcrime\b/i];
// Does the model's line say what the stock line says, and nothing else that can be checked?
export function keepsFacts(stock, said, opts = {}) {
  const s = String(said || '').trim();
  if (s.length < 8 || s.length > 300 || /[\n\r*#_`<>{}\[\]|]/.test(s)) return false;
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) return false; // no emoji in a spoken line
  const words = s.split(/\s+/).length;
  if (words > (opts.max || 34)) return false;
  if (s.includes('?') && !String(stock).includes('?')) return false;   // she does not ask questions mid sentence
  const a = numbersIn(stock), b = numbersIn(s);
  if (a.size !== b.size || [...a].some((n) => !b.has(n))) return false;  // every number kept, none added
  for (const name of opts.must || []) if (name && !s.toLowerCase().includes(String(name).toLowerCase())) return false;
  if (HEDGE.test(stock) && !HEDGE.test(s)) return false;                 // an estimate stays an estimate
  if (/\basking\b/i.test(stock) && !/\basking\b/i.test(s)) return false; // an asking price stays an asking price
  if (UNFAIR_RE.test(s)) return false;
  // a topic the stock line does not bring up stays out (an apartment's amenities are not an HOA)
  for (const re of TOPICS) if (re.test(s) && !re.test(String(stock))) return false;
  return true;
}
