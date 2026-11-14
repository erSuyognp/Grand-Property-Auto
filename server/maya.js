// Maya, the voice sales agent: /api/maya streams Claude's reply sentence by sentence while it
// calls tools that read only our local insight files; /api/maya/tts streams her voice.
// Runs only when LLM_ENABLED=true and a key is set; otherwise the game uses her scripted lines
// (src/mayaScript.js), which are built from the same tools.
//
// What the model receives: the player's words, their stated preferences, and numbers about
// homes named h1, h2, ... (no street address, listing id, agent or tenant data).
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { makeTools, CLIENT_TOOLS, label } from '../src/mayaTools.js';

const MODEL = process.env.MAYA_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const CITY_NAME = { la: 'Los Angeles', houston: 'Houston', mock: 'Mockingbird Heights' };
let client = null;
const getClient = () => (client ||= new Anthropic({ maxRetries: 0 }));

// Speed first: no thinking between the question and the first word where the model allows it.
function speedParams(model) {
  const out = { output_config: { effort: 'low' } };
  if (/sonnet-5-5/.test(model)) out.thinking = { type: 'between_tools' };
  else if (/haiku-5-5|claude-opus-5$|sonnet-5$|opus-4|sonnet-4/.test(model)) out.thinking = { type: 'disabled' };
  return out;
}

export const FAIR_HOUSING_RULES = `Fair housing rules. Follow them word for word:
5. Never show or mention race, ethnicity, religion, national origin, sex, disability, or whether families or children live in an area. Never use words like "safe", "unsafe", "good neighborhood", "bad area", "exclusive", "family friendly", "rich", "poor", "up and coming", or "the right kind of people".
6. Income is shown as a fact: "Median household income $X (Census, 20XX)" with a neutral comparison against the city median. No "rich" or "middle class" labels.
7. Recommendations are based only on what the player asked for (budget, size, features, commute, amenities), never on who lives somewhere.
8. Schools: say which schools are nearby and how far, and the schools named in the listing. No school ratings or opinions about school quality.`;

const SYSTEM = `You are Maya, the voice of a driving game for home buyers and renters called Grand Property Auto. You are an original character: a friendly, sharp local real estate agent. Your words are spoken aloud by a text to speech voice and shown as captions.

How you talk:
- Short spoken sentences. Specific numbers. Honest about downsides. Never pushy. No lists, no markdown, no emoji, no headings.
- Under about 40 words unless the player asks for detail.
- Write numbers as digits with dollar signs ("$860,000", "about $2,900 a month", "$267 a square foot"): the voice reads them correctly and the captions stay easy to scan. Round sensibly.
- Homes are named h1, h2 and so on in your tools. Never say those names aloud: describe a home by its facts ("the 3 bed at $860,000").

Facts:
- Only state facts that came back from a tool in this conversation. If you do not know, say so plainly. Never guess a number.
- Monthly cost, electric bill, solar savings, insurance pressure and drive times are estimates: say "about" or "estimated". You are not giving financial, legal or insurance advice; say so if asked for advice on what they should do with their money.
- Texas does not disclose sale prices, so a recently sold Texas home shows its last asking price. Say that when it matters.

What to do:
- When the player asks about the selected home in general (or asks for your pitch), call get_property, then give its 3 strongest real selling points from the data (not generic praise), then one honest trade off, then one question about what matters to them.
- When they ask a specific question, call the tool that answers it and answer in one or two sentences. Call show_card with the matching card while you answer (value, cost, rent, errands, outdoors, energy, risk, activity, schools, hoa, income, noise).
- When the player states a lasting preference (a budget, bedrooms, a yard, a pool, where they work, renting or buying), call remember_preference with a few words. Use their preferences in every answer and in find_alternatives.
- When they ask for something better, cheaper, bigger or different, call find_alternatives with priorities built from what they said and their preferences. Say in one sentence why the best one fits better, then offer to drive there: "Want me to take you? It's about 3 minutes away." Only call start_route after they say yes (or if they directly ask to go).
- "Find me ..." searches with no home in mind: call set_filters with their words.
- "Can I afford it" questions: call affordability_check. If you do not have their income, ask for it.
- Questions about their work, school or other places: call drive_to_my_places. If they tell you a place ("my work is near Union Station"), call pin_place.

${FAIR_HOUSING_RULES}
If the player asks who lives in an area, whether it is "safe", whether it is "good for kids" or anything else about the people, do not answer that and do not lecture. In one sentence say you can't speak to who lives somewhere, then give facts about the place they can use instead: distances to parks, schools and shops, commute, hazard and flood facts from FEMA, prices, street noise distances. For crime questions, say you don't have crime data and suggest checking the local police department's public crime map.`;

const num = { type: 'number' }, str = { type: 'string' }, bool = { type: 'boolean' };
const HOME = { type: 'string', description: 'A home name such as h3. Use "selected" for the home the player has selected.' };
const tool = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } });
export const TOOLS = [
  tool('get_property', 'Facts about one home: price, size, value against nearby homes, estimated monthly cost parts, rent nearby, energy and solar, risk, nearest places, noise distances, HOA, scores, its strongest points and trade offs.', { home: HOME }, ['home']),
  tool('compare', 'Two homes side by side.', { homeA: HOME, homeB: HOME }, ['homeA', 'homeB']),
  tool('find_alternatives', 'Rank the other homes in this area by the player\'s priorities and return the top 3 with the reason each is a better fit.', {
    home: HOME,
    priorities: { type: 'object', additionalProperties: false, properties: { maxPrice: num, maxMonthly: num, minBeds: num, budget: bool, pool: bool, solar: bool, lowHoa: bool, outdoors: bool, value: bool, commute: bool, lowRisk: bool, bigger: bool, kind: { type: 'string', enum: ['buy', 'rent'] } } },
  }, ['home']),
  tool('nearby', 'Nearest places of one kind with walk and drive times.', { home: HOME, category: { type: 'string', enum: ['supermarket', 'school', 'park', 'transit', 'gym', 'pharmacy', 'hospital', 'cafe', 'restaurant'] } }, ['home', 'category']),
  tool('monthly_cost', 'Recalculate the estimated monthly cost of owning a home for a down payment and with or without rooftop solar.', { home: HOME, downPaymentPct: num, solar: bool }, ['home']),
  tool('affordability_check', 'The 28% / 36% guideline: what monthly housing cost and price fit an income, and how this home compares. A guideline, not advice.', { home: HOME, yearlyIncome: num, monthlyDebts: num, savings: num, targetMonthly: num }, ['home']),
  tool('drive_to_my_places', 'Estimated drive time from a home to each place the player pinned (work, school, gym).', { home: HOME }, ['home']),
  tool('room_fit', 'Room sizes from the 3D scan, to answer "will my 8 ft sofa fit?".', { home: HOME, itemLengthFt: num, room: str }, ['home', 'itemLengthFt']),
  tool('same_money_other_city', 'What the same monthly cost gets in the other city (Houston or Los Angeles).', { home: HOME }, ['home']),
  tool('start_route', 'Start the GPS guide in the game to a home. Only after the player agrees to go.', { home: HOME }, ['home']),
  tool('set_filters', 'Search the map: highlights homes that match plain words like "three bedrooms under 900k with a pool near a park".', { query: str }, ['query']),
  tool('start_mission', 'Open the client inbox, or start a client mission by its id (1 to 11).', { missionId: str }),
  tool('show_card', 'Flash a card on the home panel while you talk about it.', { cardName: { type: 'string', enum: ['value', 'cost', 'rent', 'errands', 'outdoors', 'energy', 'risk', 'activity', 'schools', 'hoa', 'income', 'noise'] } }, ['cardName']),
  tool('remember_preference', 'Remember something lasting the player said they want, in a few words ("budget 900k", "wants a yard", "works downtown").', { preference: str }, ['preference']),
  tool('pin_place', 'Pin a place that matters to the player (work, a school, a gym) by name or address so drive times can be shown.', { name: str, where: str }, ['name', 'where']),
  tool('open_compare', 'Open the compare screen with the player\'s saved homes.', {}),
  tool('fast_travel', 'Switch the game to the other city.', { city: { type: 'string', enum: ['la', 'houston'] } }, ['city']),
];

export function createMaya({ root, mode, enabled }) {
  const cache = new Map();
  function db(city) {
    if (mode === 'mock') city = 'mock';
    if (!['la', 'houston', 'mock'].includes(city)) return null;
    if (cache.has(city)) return cache.get(city);
    const dir = path.join(root, 'public', 'data', city);
    const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
    const listings = read('listings.json');
    const index = read('insights/index.json');
    if (!listings || !index) return null;
    const rows = new Map(index.map((r) => [String(r.id), r]));
    const area = read('area.json') || {};
    const d = {
      city, listings, money: area.insights?.money || {},
      row: (id) => rows.get(String(id)) || null,
      ins: async (id) => read(`insights/${String(id).replace(/[^\w-]/g, '')}.json`),
      rooms: async (l) => {
        const m = (l.matterportIds || [])[0];
        const j = m && read(`mp/${String(m).replace(/[^\w-]/g, '')}.json`);
        return (j?.rooms || []).filter((r) => r.area > 2 && r.label && !/other|stair|closet/i.test(r.label)).map((r) => ({ label: r.label, areaSqft: Math.round(r.area * 10.764), longFt: Math.round(Math.sqrt(r.area * 1.5) * 3.281) }));
      },
      other: async () => {
        const oc = city === 'la' ? 'houston' : city === 'houston' ? 'la' : null;
        const o = oc && db(oc);
        return o ? { city: oc, name: CITY_NAME[oc], rows: [...o._rows.values()] } : null;
      },
      _rows: rows,
    };
    cache.set(city, d);
    return d;
  }

  const ready = () => enabled && !!process.env.ANTHROPIC_API_KEY;

  async function handle(req, res) {
    const b = req.body || {};
    const d = db(String(b.city || ''));
    if (!ready() || !d) return res.json({ scripted: true, reason: !d ? 'no data' : 'llm off' });
    const text = String(b.text || '').slice(0, 400);
    const T = makeTools(d);
    const selected = d.listings.find((l) => String(l.id) === String(b.selected)) || null;
    const fix = (ref) => (ref === 'selected' || ref == null ? (selected ? T.alias(selected.id) : null) : ref);
    const extra = {
      profile: b.profile && Number(b.profile.income) > 0 ? { income: Number(b.profile.income), debts: Number(b.profile.debts) || 0, savings: Number(b.profile.savings) || 0, target: Number(b.profile.target) || 0 } : null,
      places: (Array.isArray(b.places) ? b.places : []).slice(0, 3).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)).map((p) => ({ name: String(p.name || 'Place').slice(0, 40), lat: p.lat, lon: p.lon })),
    };
    const history = (Array.isArray(b.history) ? b.history : []).slice(-8).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
    while (history.length && history[0].role !== 'user') history.shift();
    // the selected home's facts ride along, so most answers need no tool round trip first
    let facts = null;
    if (selected) { try { facts = await T.get_property({ home: T.alias(selected.id) }); } catch { /* she can still call the tool */ } }
    const ctxLines = [
      `City: ${CITY_NAME[d.city]}. ${d.listings.length} homes and apartment communities in this neighborhood.`,
      selected ? `Selected home: ${T.alias(selected.id)} (${label(selected, d.row(selected.id))}).` : 'No home is selected right now.',
      (b.prefs || []).length ? `Player preferences so far: ${(b.prefs || []).slice(0, 10).map((p) => String(p).slice(0, 60)).join('; ')}.` : '',
      extra.profile ? `Their profile: income $${extra.profile.income} a year, monthly debts $${extra.profile.debts}, savings $${extra.profile.savings}.` : '',
      extra.places.length ? `Their pinned places: ${extra.places.map((p) => p.name).join(', ')}.` : '',
      (b.saved || []).length ? `Saved homes: ${(b.saved || []).slice(0, 6).map((id) => T.alias(id)).filter((a) => a !== 'h0').join(', ')}.` : '',
      b.mission ? `Active client mission: ${String(b.mission).slice(0, 200)}.` : '',
      b.offered ? `You offered to drive to ${T.alias(b.offered)} in your last turn.` : '',
      history.length ? 'Your earlier replies in this conversation were built from tool results that are not repeated here; their numbers were verified then.' : '',
      facts ? `Result of get_property for the selected home (already fetched for you, treat it as a tool result; call other tools only for what it does not cover):
${JSON.stringify(facts)}` : '',
    ].filter(Boolean).join('\n');
    const messages = [...history, { role: 'user', content: `<game_state>\n${ctxLines}\n</game_state>\n\nThe player says: "${text === '__pitch__' ? 'Tell me about this home.' : text}"` }];

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const started = Date.now();
    let closed = false, firstText = 0, said = '';
    const calls = [];
    res.on('close', () => { closed = true; });
    if (facts) { calls.push('get_property'); send('tool', { name: 'get_property', preloaded: true }); }
    try {
      for (let turn = 0; turn < 6 && !closed; turn++) {
        const stream = getClient().messages.stream({
          model: MODEL, max_tokens: 1200, ...speedParams(MODEL),
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS, messages,
        }, { timeout: 20000 });
        stream.on('text', (delta) => { if (!firstText) firstText = Date.now() - started; said += delta; if (!closed) send('text', { delta }); });
        const msg = await stream.finalMessage();
        if (msg.stop_reason === 'refusal') { send('fallback', { reason: 'refusal' }); break; }
        if (msg.stop_reason !== 'tool_use') break;
        messages.push({ role: 'assistant', content: msg.content });
        const results = [];
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          const input = { ...(block.input || {}) };
          for (const k of ['home', 'homeA', 'homeB']) if (k in input) input[k] = fix(input[k]);
          let out;
          try {
            if (CLIENT_TOOLS.includes(block.name)) {
              const l = input.home ? T.resolve(input.home) : null;
              send('action', { name: block.name, input: { ...input, id: l ? String(l.id) : undefined } });
              out = block.name === 'start_route' ? (l ? { ok: true, started: true, to: label(l, d.row(l.id)) } : { error: 'No such home' }) : { ok: true };
            } else if (typeof T[block.name] === 'function') {
              out = await T[block.name](input, extra);
              if (block.name === 'find_alternatives' && out.alternatives) send('action', { name: 'alternatives', input: { ids: out.alternatives.map((a) => String(T.resolve(a.home).id)), why: out.alternatives.map((a) => a.betterBecause) } });
            } else out = { error: 'Unknown tool' };
          } catch (e) { out = { error: String(e.message || e).slice(0, 120) }; }
          calls.push(block.name);
          send('tool', { name: block.name });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out), is_error: !!out.error });
        }
        messages.push({ role: 'user', content: results });
        if (said && !/\s$/.test(said)) { said += ' '; send('text', { delta: ' ' }); }
      }
      send('done', { text: said.trim(), tools: calls, firstTextMs: firstText, ms: Date.now() - started, model: MODEL });
    } catch (e) {
      const kind = e instanceof Anthropic.RateLimitError ? 'rate limited' : e instanceof Anthropic.AuthenticationError ? 'bad key' : e instanceof Anthropic.APIError ? `api ${e.status}` : 'network';
      console.warn('[maya] falling back to scripted lines:', kind, String(e.message || e).slice(0, 160));
      if (!closed) send('fallback', { reason: kind, partial: said.trim(), tools: calls });
    }
    res.end();
  }

  // Maya's voice: one sentence in, streamed audio out (ElevenLabs). The browser voice is the fallback.
  const ttsKey = process.env.ELEVENLABS_API_KEY || (String(process.env.TTS_API_KEY || '').startsWith('sk_') ? process.env.TTS_API_KEY : '');
  const ttsReady = () => enabled && !!ttsKey && mode !== 'mock';
  async function tts(req, res) {
    if (!ttsReady()) return res.status(404).json({ error: 'tts off' });
    const text = String(req.body?.text || '').slice(0, 600);
    if (!text) return res.status(400).json({ error: 'no text' });
    const voice = process.env.ELEVENLABS_VOICE_ID || process.env.TTS_VOICE || 'hpp4J3VqNfWAUOO0d1Us';
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_64&optimize_streaming_latency=3`, {
        method: 'POST', headers: { 'xi-api-key': ttsKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }), signal: AbortSignal.timeout(8000),
      });
      if (!r.ok || !r.body) return res.status(502).json({ error: 'tts provider ' + r.status });
      res.set('content-type', 'audio/mpeg');
      Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
    } catch { res.status(504).json({ error: 'tts timeout' }); }
  }
  return { handle, tts, ready, ttsReady, model: MODEL };
}
