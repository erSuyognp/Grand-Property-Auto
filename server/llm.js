// Claude calls for the two places the game uses an LLM: turning one spoken line into filters,
// and writing a two sentence arrival narration. Never a chat: JSON or one short line out.
// Only runs when LLM_ENABLED=true. The model sees the spoken words, the current filter
// values and a few numbers of the last home; no addresses, ids or agent data.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MISSION_TIMEOUT = Number(process.env.MISSION_TIMEOUT_MS || 3000);
let client = null;

export function llmReady() {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 0 });
  return client;
}

const MISSION_SYSTEM = `You turn one spoken line from a home buyer into search filters for a driving game.
Reply with JSON only, no prose, no code fence, exactly this shape:
{"filters":{"kind":"sale"|"rent"|"apartments"|"sold"|null,"minPrice":number|null,"maxPrice":number|null,"minRent":number|null,"maxRent":number|null,"minBeds":number|null,"minBaths":number|null,"minSqft":number|null,"minLotAcres":number|null,"pool":true|false|null,"features":[string]},
"near":[string],"relative":"cheaper"|"bigger"|"closer"|null,"similar":boolean,"say":string}
Rules:
- Prices are US dollars as plain numbers (900k is 900000). Monthly rents go in minRent/maxRent.
- features are short lowercase phrases matched against listing text: "garage", "island kitchen", "fireplace", "schools", "yard", "office", "patio", "view", "hardwood".
- near is things to be close to, from: "park", "school", "shopping center", "playground", "tennis court", "water", or one new lowercase word.
- relative is set only when the line compares with the last home ("cheaper", "something bigger", "closer to a park"). Leave the changed numbers null; the game computes them.
- similar is true for "more like this one".
- Keep filters the buyer did not mention null. Start from the current filters only if the line clearly adds to them.
- say is one short friendly sentence (under 16 words) confirming what you are looking for. Never ask a question.`;

function textOf(msg) {
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

const NUM_KEYS = ['minPrice', 'maxPrice', 'minRent', 'maxRent', 'minBeds', 'minBaths', 'minSqft', 'minLotAcres'];
export function validateMission(obj) {
  if (!obj || typeof obj !== 'object' || typeof obj.filters !== 'object' || !obj.filters) return null;
  const f = obj.filters;
  const out = { kind: ['sale', 'rent', 'apartments', 'sold'].includes(f.kind) ? f.kind : null, pool: typeof f.pool === 'boolean' ? f.pool : null, features: [] };
  for (const k of NUM_KEYS) {
    const v = f[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? v : null;
  }
  if (Array.isArray(f.features)) out.features = f.features.filter((x) => typeof x === 'string').map((x) => x.toLowerCase().slice(0, 40)).slice(0, 6);
  const near = Array.isArray(obj.near) ? obj.near.filter((x) => typeof x === 'string').map((x) => x.toLowerCase().slice(0, 30)).slice(0, 3) : [];
  const relative = ['cheaper', 'bigger', 'closer'].includes(obj.relative) ? obj.relative : null;
  const say = typeof obj.say === 'string' ? obj.say.slice(0, 160) : '';
  const empty = !relative && !near.length && !out.features.length && out.pool == null && !out.kind && NUM_KEYS.every((k) => out[k] == null) && !obj.similar;
  return { filters: out, near, relative, similar: obj.similar === true, say, empty };
}

async function ask(system, user, timeout, maxTokens) {
  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // speed matters more than depth here: no thinking between tools, low effort
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  }, { timeout });
  if (msg.stop_reason === 'refusal') throw new Error('refused');
  return textOf(msg);
}

export async function llmMission(transcript, filters, last) {
  const started = Date.now();
  const user = JSON.stringify({ said: transcript, currentFilters: filters || null, lastHome: last || null });
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = MISSION_TIMEOUT - (Date.now() - started);
    if (left < 600) break;
    const raw = await ask(MISSION_SYSTEM, user, left, 600);
    try {
      const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const ok = validateMission(json);
      if (ok) return ok;
    } catch { /* retry once */ }
  }
  return null;
}

const NARRATE_SYSTEM = `You are the voice of a driving game for home buyers. The player just pulled up to a home.
Write exactly two short spoken sentences (under 40 words total) about it from the facts given.
Lead with what matters to a buyer (price, beds, a standout feature). Work in one fact seen from the air
(pool, trees, solar, a park nearby) when there is one. If aerial.pool is true and aerial.listingMentionsPool is false,
say the listing does not mention a pool but one is visible from above. Plain words, no hype, no questions, no emoji,
no address. Numbers as you would say them aloud.`;

export async function llmNarrate(facts) {
  const text = await ask(NARRATE_SYSTEM, JSON.stringify(facts), 5000, 300);
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean && clean.length < 400 ? clean : null;
}
