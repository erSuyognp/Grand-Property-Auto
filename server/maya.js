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
import { keepsFacts } from '../src/lines.js';

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

export const SYSTEM = `You are Maya, the voice of a driving game for home buyers and renters called Grand Property Auto. You are an original character: a friendly, sharp local real estate agent. Your words are spoken aloud by a text to speech voice and shown as captions.

How you talk:
- Short spoken sentences. Specific numbers. Honest about downsides. Never pushy. No lists, no markdown, no emoji, no headings.
- Under about 40 words unless the player asks for detail.
- Write numbers as digits with dollar signs ("$860,000", "about $2,900 a month", "$267 a square foot"): the voice reads them correctly and the captions stay easy to scan. Round sensibly.
- Homes are named h1, h2 and so on in your tools. Never say those names aloud: describe a home by its facts ("the 3 bed at $860,000").
- Talk like a person showing a friend around, not like a spec sheet: lead with the one thing that matters most, then the numbers. The game has already introduced you, so never greet again, say your name or introduce yourself unless the player asks who you are.

Facts:
- Only state facts that came back from a tool in this conversation. If you do not know, say so plainly. Never guess a number.
- Monthly cost, electric bill, solar savings, insurance pressure and drive times are estimates: say "about" or "estimated". You are not giving financial, legal or insurance advice; say so if asked for advice on what they should do with their money.
- Texas does not disclose sale prices, so a recently sold Texas home shows its last asking price. Say that when it matters.

What to do:
- When the player asks about the selected home in general (or asks for your pitch), call get_property, then give its 3 strongest real selling points from the data (not generic praise), then one honest trade off, then one question about what matters to them.
- Cover the whole picture, not only what is nearby. Groceries, parks and shops are one part; owning the home is the other: the insurance estimate and hazard risk, the HOA fee and what it covers, community amenities, property tax, the electric bill and solar. When you offer something more or pick what to say next, choose a topic you have not covered yet in this conversation, and do not repeat a fact you already said unless asked.
- When they ask a specific question, call the tool that answers it and answer in one or two sentences. Call show_card with the matching card while you answer (value, cost, rent, errands, outdoors, energy, risk, activity, schools, hoa, income, noise).
- When the player states a lasting preference (a budget, bedrooms, a yard, a pool, where they work, renting or buying), call remember_preference with a few words. Use their preferences in every answer and in find_alternatives.
- When they ask for something better, cheaper, bigger or different, call find_alternatives with priorities built from what they said and their preferences. Say in one sentence why the best one fits better, then offer to drive there: "Want me to take you? It's about 3 minutes away." Only call start_route after they say yes (or if they directly ask to go).
- "Find me ..." searches with no home in mind: call set_filters with their words.
- The map: whenever you point to a home that is not the selected one (from compare, a search, the saved homes, or "which one is that?"), call show_on_map with it so its building glows and its dot is ringed on the minimap and the big map (key M). Only say a home is marked, lit up, highlighted or shown on the map when show_on_map, find_alternatives or set_filters returned ok in this same turn, or the game state lists it as lit up right now. If the tool failed, say you could not mark it.
- "Can I afford it" questions: call affordability_check. If you do not have their income, ask for it.
- Questions about their work, school or other places: call drive_to_my_places. If they tell you a place ("my work is near Union Station"), call pin_place.

${FAIR_HOUSING_RULES}
If the player asks who lives in an area, whether it is "safe", whether it is "good for kids" or anything else about the people, do not answer that and do not lecture. Do not repeat the banned words back even to decline them: say "I can't rate an area" or "I can't speak to who lives somewhere". In one sentence say you can't speak to who lives somewhere, then give facts about the place they can use instead: distances to parks, schools and shops, commute, hazard and flood facts from FEMA, prices, street noise distances. For crime questions, say you don't have crime data and suggest checking the local police department's public crime map. Do not bring up income or any other statistic about residents in those answers: mention the Census income figure only when the player asks for income directly, and then as a plain number next to the city's.`;

// The same lines, never the same way twice. The game has stock wording for everything Maya
// says by herself (the flyover of a home, the walk through its rooms). With the model on, she
// says each of those lines in her own words instead. The stock line is the only source of
// facts: every line she writes is checked against it (src/lines.js) before the game uses it.
export const SAY_SYSTEM = `You are Maya, the voice of a driving game for home buyers and renters called Grand Property Auto. You are an original character: a friendly, sharp local real estate agent. Your words are spoken aloud by a text to speech voice, one line at a time, while the game shows what you are talking about.

The game gives you numbered items. Each item is a line it would say in its own stock wording. Say every item in your own words, so that no two showings ever sound the same.

Output format, exactly: one line per item, in the same order, written as
key: your line
Nothing else. No preamble, no numbering, no blank lines, no quotation marks, no markdown.

Rules for every line:
- Keep each number exactly as written, as digits with its dollar sign or unit. Never add, drop, round, convert or spell out a number.
- Keep every name exactly as written: places, communities, FEMA, HOA.
- Add no fact, figure or claim that is not in the item. No opinions about the area or about who lives there.
- Never say where something is or which way to go (next to, across from, along the street, at the edge of a ring, up ahead, over there): the item gives a time, not a place.
- Keep the hedges. When the item says about, roughly, estimated or likely, your line says so too. An asking price stays an asking price.
- Stay within the word limit shown for the item: one or two short spoken sentences.
- No questions.
- Sound like a person showing a friend around, not a spec sheet. Change the shape of the sentences from item to item, use a connecting word now and then, and never start two lines in a row the same way.

${FAIR_HOUSING_RULES}`;
const SAY_KIND = {
  reveal: 'The moment: a flyover of one home. The map shows each thing as you say its line (the home, walking rings, the nearest places one by one, the roof), then the insight panel of the home opens one card at a time as you explain it (price against similar homes, the monthly cost, energy, risk, HOA, then the rest). Every line stays on its own item, and the lines run as one spoken walkthrough, so let them flow into each other.',
  tour: 'The moment: you are walking the buyer through the rooms of one home, one line per room, while they look around it. Keep any invitation to press a key (R to measure) exactly.',
  line: 'The moment: single lines you say to the player while they drive.',
};
const SAY_TONES = ['brisk and upbeat, like you have somewhere good to show them next', 'warm and unhurried', 'plain and matter of fact, a little dry', 'like a friend pointing things out from the passenger seat', 'quietly confident, in short sentences', 'curious and light, as if this is the part of the job you enjoy'];

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
  tool('set_filters', 'Search the map: lights up the homes that match plain words like "three bedrooms under 900k with a pool near a park", and starts a route to the best one. The result says how many matched and which homes are lit.', { query: str }, ['query']),
  tool('show_on_map', 'Light up one or more homes so the player can see which ones you mean: their buildings glow gold in the world and their dots are ringed on the minimap and the big map. The first one is the main one.', { homes: { type: 'string', description: 'Home names separated by commas, for example "h3, h7". Up to 6. "selected" is the selected home.' } }, ['homes']),
  tool('start_mission', 'Open the client inbox, or start a client mission by its id (1 to 11).', { missionId: str }),
  tool('show_card', 'Flash a card on the home panel while you talk about it.', { cardName: { type: 'string', enum: ['value', 'cost', 'rent', 'errands', 'outdoors', 'energy', 'risk', 'activity', 'schools', 'hoa', 'income', 'noise'] } }, ['cardName']),
  tool('remember_preference', 'Remember something lasting the player said they want, in a few words ("budget 900k", "wants a yard", "works downtown").', { preference: str }, ['preference']),
  tool('pin_place', 'Pin a place that matters to the player (work, a school, a gym) by name or address so drive times can be shown.', { name: str, where: str }, ['name', 'where']),
  tool('open_compare', 'Open the compare screen with the player\'s saved homes.', {}),
  tool('set_sun_time', 'Move the sun over the selected home to a time of day (hour 6 to 20, local time).', { hour: num }, ['hour']),
  tool('print_shortlist', 'Open the one page shortlist report of the saved homes for printing.', {}),
  tool('measure', 'Tell the player how the tape measure works: inside a home, key R, then click two points.', {}),
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
      Array.isArray(b.lit) && b.lit.length ? `Lit up on the map right now: ${b.lit.slice(0, 6).map((id) => d.listings.find((l) => String(l.id) === String(id))).filter(Boolean).map((l) => `${T.alias(l.id)} (${label(l, d.row(l.id))})`).join(', ')}.` : 'No homes are lit up on the map right now.',
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
            if (block.name === 'show_on_map') {
              const ls = [...new Set(String(input.homes || '').split(/[\s,]+/).filter(Boolean).map((h) => T.resolve(fix(h))).filter(Boolean))].slice(0, 6);
              if (ls.length) send('action', { name: 'show_on_map', input: { ids: ls.map((l) => String(l.id)) } });
              out = ls.length ? { ok: true, marked: ls.length, homes: ls.map((l) => label(l, d.row(l.id))) } : { error: 'No such home, nothing was marked' };
            } else if (block.name === 'set_filters') {
              send('action', { name: block.name, input });
              out = { ok: true, note: 'The game is lighting up the matches and announces how many it found itself. Do not state a count or describe the matches; one short lead-in is enough.' };
            } else if (CLIENT_TOOLS.includes(block.name)) {
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

  // Stock lines in, Maya's own wording out, as an event stream: one "line" event for every line
  // that passed the fact check, as soon as it is written. Lines that fail are left out and the
  // game says its stock line for them. What the model receives: the stock sentences (numbers,
  // place names, the home's facts; no street address, listing id or agent data), what the
  // player said they want, and a few of her own recent lines so she does not repeat herself.
  async function say(req, res) {
    const b = req.body || {};
    if (!ready()) return res.json({ scripted: true, reason: 'llm off' });
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 24)
      .map((x) => ({ key: String(x?.key || '').toLowerCase(), text: String(x?.text || '').replace(/\s+/g, ' ').trim().slice(0, 320), must: (Array.isArray(x?.must) ? x.must : []).slice(0, 4).map((m) => String(m).slice(0, 60)), max: Math.max(8, Math.min(40, Number(x?.max) || 30)) }))
      .filter((x) => /^[a-z0-9_]{1,32}$/.test(x.key) && x.text.length > 3);
    if (!lines.length) return res.json({ scripted: true, reason: 'no lines' });
    const short = (a, n, len) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, len)).filter(Boolean);
    const prefs = short(b.prefs, 8, 60), avoid = short(b.avoid, 12, 200);
    const user = [
      SAY_KIND[b.kind] || SAY_KIND.line,
      b.intro ? 'This is the first time you speak to this player: open the first line by saying you are Maya, their agent, in a few words.' : 'The player already knows you: no greeting, and do not say your name.',
      prefs.length ? `The buyer told you they want: ${prefs.join('; ')}. Where a line touches one of those, you may say so in words, without adding any number.` : '',
      `Delivery for this take: ${SAY_TONES[Math.floor(Math.random() * SAY_TONES.length)]}.`,
      avoid.length ? `You said these in earlier showings. Do not open a line the same way and do not reuse their phrasing:\n${avoid.map((x) => `- ${x}`).join('\n')}` : '',
      `Take ${1000 + Math.floor(Math.random() * 9000)}.`,
      '',
      'Items:',
      ...lines.map((x, i) => `${i + 1}. key=${x.key} | at most ${x.max} words | ${x.text}`),
    ].filter((x, i) => x || i === 6).join('\n');

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const started = Date.now(), byKey = new Map(lines.map((x) => [x.key, x])), sent = new Set();
    let closed = false, buf = '', firstMs = 0, dropped = 0, stream = null;
    res.on('close', () => { closed = true; try { stream?.abort(); } catch { /* already finished */ } });
    const take = (raw) => {
      const m = /^\s*(?:\d+[.)]\s*)?(?:key=)?([a-z0-9_]+)\s*:\s*(.+?)\s*$/i.exec(raw);
      const src = m && byKey.get(m[1].toLowerCase());
      if (!src || sent.has(src.key)) return;
      const text = m[2].replace(/^["“”']+|["“”']+$/g, '').replace(/\s+/g, ' ').trim();
      if (!keepsFacts(src.text, text, { must: src.must, max: src.max })) { dropped++; return; }
      sent.add(src.key);
      if (!firstMs) firstMs = Date.now() - started;
      send('line', { key: src.key, text });
    };
    try {
      stream = getClient().messages.stream({
        model: MODEL, max_tokens: 1500, ...speedParams(MODEL),
        system: [{ type: 'text', text: SAY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      }, { timeout: 15000 });
      stream.on('text', (delta) => { buf += delta; let i; while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); } });
      const msg = await stream.finalMessage();
      if (buf.trim()) take(buf);
      if (msg.stop_reason === 'refusal') send('fallback', { reason: 'refusal' });
      send('done', { asked: lines.length, written: sent.size, dropped, firstMs, ms: Date.now() - started, model: MODEL });
    } catch (e) {
      const kind = e instanceof Anthropic.RateLimitError ? 'rate limited' : e instanceof Anthropic.AuthenticationError ? 'bad key' : e instanceof Anthropic.APIError ? `api ${e.status}` : 'network';
      if (!closed) console.warn('[maya] could not write her own lines, the game says its stock lines:', kind, String(e.message || e).slice(0, 160));
      send('fallback', { reason: kind, written: sent.size });
    }
    res.end();
  }

  // Maya's voice: one sentence in, streamed audio out (ElevenLabs). The browser voice is the fallback.
  const ttsKey = process.env.ELEVENLABS_API_KEY || (String(process.env.TTS_API_KEY || '').startsWith('sk_') ? process.env.TTS_API_KEY : '');
  // The voice can come from OpenAI instead: set OPENAI_API_KEY (speech out and speech to text
  // both move there). TTS_PROVIDER=elevenlabs or openai picks one when both keys are set; with
  // no choice made, an OpenAI key wins. The live press-V conversation is an ElevenLabs agent,
  // so with OpenAI the V key is push to talk: Claude answers, OpenAI speaks.
  const openaiKey = process.env.OPENAI_API_KEY || (String(process.env.TTS_API_KEY || '').startsWith('sk-') ? process.env.TTS_API_KEY : '');
  const provider = (() => { const p = String(process.env.TTS_PROVIDER || '').toLowerCase(); return p === 'openai' || p === 'elevenlabs' ? p : openaiKey ? 'openai' : 'elevenlabs'; })();
  const OA_VOICES = [['coral', 'Warm, friendly'], ['sage', 'Calm, thoughtful'], ['nova', 'Bright, energetic'], ['shimmer', 'Clear, soft'], ['alloy', 'Neutral, balanced'], ['ballad', 'Gentle, melodic'], ['verse', 'Expressive'], ['ash', 'Confident'], ['echo', 'Smooth, steady'], ['fable', 'Storyteller'], ['onyx', 'Deep, grounded']];
  const oaVoice = (asked) => (OA_VOICES.some(([v]) => v === asked) ? asked : process.env.OPENAI_TTS_VOICE || 'coral');
  const OA_STYLE = 'You are Maya, a warm, upbeat real estate agent showing a home to a friend. Speak naturally and conversationally, at an easy pace, with a smile in your voice. Read dollar amounts and numbers clearly.';
  const ttsReady = () => enabled && mode !== 'mock' && (provider === 'openai' ? !!openaiKey : !!ttsKey);
  // The voices for the picker in settings: OpenAI's built in ones, or the voices on the
  // ElevenLabs account (stock voices plus any added to "My Voices").
  let voiceCache = null, voiceAt = 0;
  async function voices(_req, res) {
    if (!ttsReady()) return res.status(404).json({ error: 'tts off' });
    if (provider === 'openai') return res.json({ provider, voices: OA_VOICES.map(([id, about]) => ({ id, name: id[0].toUpperCase() + id.slice(1), about, kind: 'Stock' })), current: oaVoice('') });
    try {
      if (!voiceCache || Date.now() - voiceAt > 120000) {
        const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': ttsKey }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return res.status(502).json({ error: 'voices ' + r.status });
        voiceCache = ((await r.json()).voices || []).map((v) => ({ id: v.voice_id, name: String(v.name || '').split(' - ')[0], about: String(v.name || '').split(' - ')[1] || [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.descriptive].filter(Boolean).join(', '), kind: v.category === 'premade' ? 'Stock' : 'My voices' }));
        voiceAt = Date.now();
      }
      res.json({ voices: voiceCache, current: process.env.ELEVENLABS_VOICE_ID || process.env.TTS_VOICE || 'hpp4J3VqNfWAUOO0d1Us' });
    } catch { res.status(504).json({ error: 'voices timeout' }); }
  }
  // What the player said: a short recorded clip in, text out (ElevenLabs speech to text). Used when
  // the browser's own speech recognition cannot reach its service. Only the player's voice is sent.
  async function stt(req, res) {
    if (!ttsReady()) return res.status(404).json({ error: 'stt off' });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 800) return res.status(400).json({ error: 'no audio' });
    const type = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    const started = Date.now();
    if (provider === 'openai') {
      try {
        const form = new FormData();
        form.append('model', process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe');
        form.append('language', 'en');
        // OpenAI reads the format from the file name
        const ext = /mp4|m4a/.test(type) ? 'mp4' : /mpeg|mp3/.test(type) ? 'mp3' : /wav/.test(type) ? 'wav' : /ogg/.test(type) ? 'ogg' : 'webm';
        form.append('file', new Blob([buf], { type }), `speech.${ext}`);
        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${openaiKey}` }, body: form, signal: AbortSignal.timeout(10000) });
        if (!r.ok) { console.warn(`[maya] OpenAI speech to text answered ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`); return res.status(502).json({ error: 'stt provider ' + r.status }); }
        const text = String((await r.json()).text || '').replace(/\s+/g, ' ').trim();
        return res.json({ text: text.slice(0, 400), ms: Date.now() - started });
      } catch { return res.status(504).json({ error: 'stt timeout' }); }
    }
    try {
      const form = new FormData();
      form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
      form.append('language_code', 'en');
      form.append('tag_audio_events', 'false');
      form.append('file', new Blob([buf], { type }), type.includes('mp4') ? 'speech.mp4' : 'speech.webm');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': ttsKey }, body: form, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return res.status(502).json({ error: 'stt provider ' + r.status });
      const text = String((await r.json()).text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      res.json({ text: text.slice(0, 400), ms: Date.now() - started });
    } catch { res.status(504).json({ error: 'stt timeout' }); }
  }
  // One sentence in, audio streamed out as it is made, so the browser starts playing on the
  // first bytes. GET (an <audio> element can stream it) or POST. Model: ELEVENLABS_MODEL, default
  // the expressive eleven_v4_turbo; if the account or voice cannot use it, the fast flash model.
  const VOICE_SETTINGS = { stability: Number(process.env.ELEVENLABS_STABILITY) || 0.5, similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY) || 0.75, speed: Number(process.env.ELEVENLABS_SPEED) || 1 };
  let ttsModel = process.env.ELEVENLABS_MODEL || 'eleven_v4_turbo';
  // Credits used up: remember it for a few minutes and answer at once, so the game goes
  // straight to the browser voice instead of waiting on a request that will be refused.
  let quotaUntil = 0, lastTtsError = '';
  const ttsStatus = (_req, res) => res.json({ ok: Date.now() >= quotaUntil && !lastTtsError, reason: Date.now() < quotaUntil ? 'quota' : lastTtsError || null, provider });
  async function tts(req, res) {
    if (!ttsReady()) return res.status(404).json({ error: 'tts off' });
    if (Date.now() < quotaUntil) return res.status(429).json({ error: 'tts quota used up' });
    const src = req.method === 'GET' ? req.query : req.body || {};
    const text = String(src.text || '').slice(0, 600);
    if (!text) return res.status(400).json({ error: 'no text' });
    const asked = String(src.voice || '');
    if (provider === 'openai') {
      // OpenAI speech: the same one sentence in, mp3 streamed out as it is made
      const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
      try {
        const r = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST', headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, voice: oaVoice(asked), input: text, response_format: 'mp3', ...(/gpt-4o/.test(model) ? { instructions: process.env.OPENAI_TTS_STYLE || OA_STYLE } : {}) }),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok || !r.body) {
          const body = await r.text().catch(() => '');
          if (/insufficient_quota|billing/.test(body)) { quotaUntil = Date.now() + 300000; lastTtsError = 'quota'; console.warn('[maya] The OpenAI account has no credit left for speech. The game uses the browser voice until credit is added.'); return res.status(429).json({ error: 'tts quota used up' }); }
          lastTtsError = 'provider ' + r.status;
          console.warn(`[maya] OpenAI speech answered ${r.status}: ${body.slice(0, 160)}`);
          return res.status(502).json({ error: 'tts provider ' + r.status });
        }
        lastTtsError = '';
        res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
        Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
      } catch { if (!res.headersSent) res.status(504).json({ error: 'tts timeout' }); else res.end(); }
      return;
    }
    const voice = /^[A-Za-z0-9]{16,32}$/.test(asked) ? asked : process.env.ELEVENLABS_VOICE_ID || process.env.TTS_VOICE || 'hpp4J3VqNfWAUOO0d1Us';
    const call = (model) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_64${/flash|turbo_v2/.test(model) ? '&optimize_streaming_latency=3' : ''}`, {
      method: 'POST', headers: { 'xi-api-key': ttsKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }), signal: AbortSignal.timeout(12000),
    });
    try {
      let r = await call(ttsModel);
      if (!r.ok) {
        const body = await r.clone().text().catch(() => '');
        if (/quota_exceeded/.test(body)) {
          quotaUntil = Date.now() + 300000; lastTtsError = 'quota';
          console.warn('[maya] ElevenLabs credits are used up (quota_exceeded). The game uses the browser voice until credits are added.');
          return res.status(429).json({ error: 'tts quota used up' });
        }
      }
      if (!r.ok && ttsModel !== 'eleven_flash_v2_5') {
        console.warn(`[maya] voice model ${ttsModel} answered ${r.status}; using eleven_flash_v2_5`);
        if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) ttsModel = 'eleven_flash_v2_5';
        r = await call('eleven_flash_v2_5');
      }
      if (!r.ok || !r.body) { lastTtsError = 'provider ' + r.status; return res.status(502).json({ error: 'tts provider ' + r.status }); }
      lastTtsError = '';
      res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
    } catch { if (!res.headersSent) res.status(504).json({ error: 'tts timeout' }); else res.end(); }
  }
  // Live conversation: a short lived token for the ElevenLabs agent. The key stays on the server.
  const agentId = process.env.ELEVENLABS_AGENT_ID || '';
  const liveReady = () => provider === 'elevenlabs' && ttsReady() && !!agentId;
  async function session(req, res) {
    if (!liveReady()) return res.status(404).json({ error: 'live voice off' });
    try {
      if (req.query.text) { // no microphone, no audio: the same agent in writing
        const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { headers: { 'xi-api-key': ttsKey }, signal: AbortSignal.timeout(7000) });
        if (!r.ok) return res.status(502).json({ error: 'agent ' + r.status });
        return res.set('cache-control', 'no-store').json({ signedUrl: (await r.json()).signed_url });
      }
      const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, { headers: { 'xi-api-key': ttsKey }, signal: AbortSignal.timeout(7000) });
      if (!r.ok) return res.status(502).json({ error: 'agent ' + r.status });
      res.set('cache-control', 'no-store').json({ token: (await r.json()).token });
    } catch { res.status(504).json({ error: 'agent timeout' }); }
  }
  return { handle, say, tts, ttsStatus, stt, voices, session, liveReady, ready, ttsReady, model: MODEL, provider };
}
