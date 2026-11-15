// Sets up the ElevenLabs agent that is Maya's live voice: her prompt (the same rules as the
// in-game model, fair housing included), her tools as *client tools* (they run in the browser
// against the local insight files, so no public server is needed), a Claude model, her voice,
// and privacy settings that keep nothing on ElevenLabs' side.
//
//   node tools/setup_maya_agent.mjs            apply
//   node tools/setup_maya_agent.mjs --dry      show what would be sent
//
// Needs ELEVENLABS_API_KEY (or TTS_API_KEY) and ELEVENLABS_AGENT_ID in .env. Safe to rerun:
// the tools it made are remembered in data/maya_agent_tools.json and updated in place. It never
// touches other tools or agents on the account.
import 'dotenv/config';
import fs from 'node:fs';
import { TOOLS, SYSTEM } from '../server/maya.js';

const KEY = process.env.ELEVENLABS_API_KEY || process.env.TTS_API_KEY || '';
const AGENT = process.env.ELEVENLABS_AGENT_ID || '';
const DRY = process.argv.includes('--dry');
const LLM = process.env.MAYA_AGENT_LLM || 'claude-sonnet-5-5';
const VOICE = process.env.ELEVENLABS_VOICE_ID || 'hpp4J3VqNfWAUOO0d1Us';
const API = 'https://api.elevenlabs.io/v1/convai';
if (!KEY || !AGENT) { console.error('Set ELEVENLABS_API_KEY (or TTS_API_KEY) and ELEVENLABS_AGENT_ID in .env first.'); process.exit(1); }

async function call(method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// our JSON schema -> the agent platform's parameter schema (every value needs a description)
const WORDS = { maxPrice: 'Highest price in dollars', maxMonthly: 'Highest monthly cost in dollars', minBeds: 'Fewest bedrooms', budget: 'True when a lower cost matters most', pool: 'True when a pool is wanted', solar: 'True when solar matters', lowHoa: 'True when a low HOA fee matters', outdoors: 'True when parks or a yard matter', value: 'True when value for money matters', commute: 'True when a short commute matters', lowRisk: 'True when low hazard risk matters', bigger: 'True when more space is wanted', kind: 'buy or rent',
  homeA: 'First home', homeB: 'Second home', category: 'Kind of place', downPaymentPct: 'Down payment percent, for example 20', yearlyIncome: 'Yearly income before tax in dollars', monthlyDebts: 'Monthly debt payments in dollars', savings: 'Savings for a down payment in dollars', targetMonthly: 'Monthly housing cost they would like, in dollars', itemLengthFt: 'Length of the item in feet', room: 'Room name, for example living room',
  query: 'What to search for, in plain words', missionId: 'Mission number 1 to 11, or empty to open the inbox', cardName: 'Which card to flash', preference: 'The preference in a few words', name: 'What the place is, for example Work', where: 'Its name or address', city: 'la or houston', hour: 'Hour of the day from 6 to 20', priorities: 'What the player wants more of' };
function prop(name, p) {
  if (p.type === 'object') return { type: 'object', description: WORDS[name] || name, properties: Object.fromEntries(Object.entries(p.properties || {}).map(([k, v]) => [k, prop(k, v)])), required: p.required || [] };
  const out = { type: p.type, description: p.description || WORDS[name] || name };
  if (p.enum) out.enum = p.enum;
  return out;
}
const toolConfig = (t) => {
  const props = Object.entries(t.input_schema.properties || {});
  return {
    type: 'client', name: t.name, description: t.description, expects_response: true, response_timeout_secs: 8,
    parameters: props.length ? { type: 'object', required: t.input_schema.required || [], properties: Object.fromEntries(props.map(([k, v]) => [k, prop(k, v)])) } : null,
  };
};

const PROMPT = `${SYSTEM}

How this conversation works:
- You are speaking live with the player through their microphone while they play. Keep turns short so they can cut in.
- The game sends you notes marked [game state]: which home is selected and its facts, which homes are lit up on the map right now, the player's preferences, their pinned places, an active client mission. Treat the newest note as the current state. The facts of the selected home in a note count as a tool result.
- For the selected home pass "selected" as the home. Other homes are named h1, h2 and so on in tool results; never say those names aloud.
- Your tools run inside the game on the player's own computer. If a tool returns an error, say plainly that you could not get that and offer something else.
- Do not read out long lists. Two or three facts, then stop and let them answer.`;

const STATE = 'data/maya_agent_tools.json';
const known = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const ids = [];
for (const t of TOOLS) {
  const cfg = toolConfig(t);
  if (DRY) { console.log('tool', t.name, JSON.stringify(cfg.parameters || {}).slice(0, 140)); continue; }
  let id = known[t.name];
  if (id) {
    try { await call('PATCH', `/tools/${id}`, { tool_config: cfg }); } catch (e) { console.warn(`  could not update ${t.name} (${String(e.message).slice(0, 120)}); creating it again`); id = null; }
  }
  if (!id) id = (await call('POST', '/tools', { tool_config: cfg })).id;
  known[t.name] = id;
  ids.push(id);
  console.log(`tool ${t.name.padEnd(24)} ${id}`);
}
if (!DRY) { fs.mkdirSync('data', { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(known, null, 1)); }

const patch = {
  name: 'Maya',
  conversation_config: {
    agent: {
      // said on the first call of a game only; later calls open with a short line (src/mayaLive.js)
      first_message: "Hi, I'm Maya, your real estate AI agent. Pick a home and ask me anything, or tell me what you're looking for.",
      language: 'en',
      prompt: { prompt: PROMPT, llm: LLM, temperature: 0, tool_ids: ids, ignore_default_personality: true },
    },
    tts: { voice_id: VOICE },
    turn: { turn_timeout: 12, silence_end_call_timeout: 90 },
    conversation: { max_duration_seconds: 900, client_events: ['audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction', 'client_tool_call'] },
  },
  platform_settings: {
    // nothing about the homes is kept on the agent platform after a conversation ends
    privacy: { record_voice: false, retention_days: 0, delete_transcript_and_pii: true, delete_audio: true },
    overrides: { conversation_config_override: { tts: { voice_id: true }, agent: { first_message: true } } },
  },
};
if (DRY) { console.log(JSON.stringify({ ...patch, conversation_config: { ...patch.conversation_config, agent: { ...patch.conversation_config.agent, prompt: { ...patch.conversation_config.agent.prompt, prompt: `(${PROMPT.length} characters)` } } } }, null, 1)); process.exit(0); }
const out = await call('PATCH', `/agents/${AGENT}`, patch);
const p = out.conversation_config.agent.prompt, pr = out.platform_settings.privacy;
console.log(`\nagent ${out.name}: model ${p.llm}, ${p.tool_ids.length} tools, prompt ${p.prompt.length} characters, voice ${out.conversation_config.tts.voice_id} on ${out.conversation_config.tts.model_id}`);
console.log(`privacy: record_voice ${pr.record_voice}, retention_days ${pr.retention_days}, delete_transcript_and_pii ${pr.delete_transcript_and_pii}, delete_audio ${pr.delete_audio}`);
console.log(`client events: ${out.conversation_config.conversation.client_events.join(', ')}`);
