// Maya live: a real time voice conversation through the ElevenLabs agent. Press V once and
// just talk; she hears you, answers, and you can cut in at any time. Press V again to end.
// Her tools still run here in the browser against the local insight files (they are "client
// tools" of the agent), and the game keeps her informed with short state notes: which home is
// selected and its facts, your preferences, your pinned places, an active client mission.
// If the agent cannot be reached, V falls back to push to talk with the in-game Maya.
import { label } from './mayaTools.js';

export function initMayaLive(ctx, ui) {
  const L = { log: [], conv: null, status: 'off', mode: 'listening', lastActivity: 0, tools: [], startedAt: 0, failed: 0, heard: '', said: '', calls: 0 };
  const available = () => !!ctx.config.mayaAgent && !ctx.params.has('mute') && ctx.settings?.liveVoice !== false && !ctx.muteVoice && L.failed < 2;
  const pub = () => { window.__gpa.mayaLive = { log: L.log, start: (o) => start(o), stop: () => stop(), send: (t) => { L.conv?.sendUserMessage(t); L.lastActivity = performance.now(); }, status: L.status, mode: L.mode, tools: [...L.tools], heard: L.heard, said: L.said, available: available() }; };

  // what the game tells her: the current situation, as one short note
  async function stateNote() {
    const T = ui.tools(), l = ui.selected(), lines = [];
    const city = { la: 'Los Angeles', houston: 'Houston', mock: 'Mockingbird Heights' }[ctx.city] || ctx.city;
    lines.push(`City: ${city}. ${ctx.world.listings.length} homes and apartment communities in this neighborhood.`);
    if (l && ctx.reveal?.listing === l) {
      let facts = null;
      try { facts = await T.get_property({ home: T.alias(l.id) }); } catch { /* she can call the tool */ }
      lines.push(`Selected home: ${T.alias(l.id)} (${label(l, ctx.insights.row(l.id))}).`);
      if (facts) lines.push(`Result of get_property for the selected home: ${JSON.stringify(facts)}`);
    } else lines.push('No home is selected right now. The player is driving.');
    // what the player can see lit up: the map and the world show exactly these
    const hs = ctx.listingsSys.highlights, byId = (id) => ctx.world.listings.find((x) => x.id === id);
    const lit = hs ? [...hs].map(byId).filter(Boolean).slice(0, 6) : [];
    lines.push(lit.length ? `Lit up on the map right now (gold glow on the building, ringed dot on the minimap and the big map): ${lit.map((x) => `${T.alias(x.id)} (${label(x, ctx.insights.row(x.id))})`).join(', ')}.` : 'No homes are lit up on the map right now.');
    const mt = ctx.missions?.active ? ctx.missions.target : null;
    if (mt) lines.push(`A gold route line on the road leads to ${T.alias(mt.id)} (${label(mt, ctx.insights.row(mt.id))}).`);
    const nr = ctx.listingsSys.near;
    if (nr && nr !== l) lines.push(`The car is parked next to ${T.alias(nr.id)} (${label(nr, ctx.insights.row(nr.id))}).`);
    const prefs = ui.S.prefs.map((p) => p.text);
    if (prefs.length) lines.push(`Player preferences so far: ${prefs.join('; ')}.`);
    const b = ctx.buyer;
    if (b?.profile?.income) lines.push(`Their profile: income $${b.profile.income} a year, monthly debts $${b.profile.debts || 0}, savings $${b.profile.savings || 0}.`);
    if (b?.places?.length) lines.push(`Their pinned places: ${b.places.map((p) => p.name).join(', ')}.`);
    const saved = ctx.saved.list().map((x) => T.alias(x.id));
    if (saved.length) lines.push(`Saved homes: ${saved.join(', ')}.`);
    if (ctx.clients?.active) lines.push(`Active client mission: ${ctx.clients.brief()}`);
    if (ctx.tour?.active) lines.push(ctx.guide?.brief() || 'The player is walking through the home in 3D.');
    return `[game state]\n${lines.join('\n')}`;
  }
  let noteTimer = 0;
  function note(delay = 250) {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => { if (L.conv && L.status === 'connected') { try { L.conv.sendContextualUpdate(await stateNote()); } catch { /* closed */ } } }, delay);
  }

  // her tools, run locally. Data tools return JSON; game tools do the thing and say so.
  function clientTools() {
    const T = ui.tools();
    const fix = (p) => { const o = { ...(p || {}) }; for (const k of ['home', 'homeA', 'homeB']) if (k in o && (o[k] === 'selected' || !o[k])) { const l = ui.selected(); o[k] = l ? T.alias(l.id) : null; } return o; };
    const data = (name) => async (p) => {
      L.tools.push(name); ui.S.lastTools.push(name); L.lastActivity = performance.now(); pub();
      try {
        const out = await T[name](fix(p), ui.extra());
        if (name === 'find_alternatives' && out.alternatives?.length) ui.act('alternatives', { ids: out.alternatives.map((a) => String(T.resolve(a.home).id)), why: out.alternatives.map((a) => a.betterBecause) });
        return JSON.stringify(out);
      } catch (e) { return JSON.stringify({ error: String(e.message || e).slice(0, 120) }); }
    };
    const game = (name) => async (p) => {
      L.tools.push(name); L.lastActivity = performance.now(); pub();
      const input = fix(p);
      const l = input.home ? T.resolve(input.home) : null;
      if (name === 'start_route' && !l) return JSON.stringify({ error: 'No such home' });
      if (name === 'show_on_map') input.ids = String(input.homes || '').split(/[\s,]+/).filter(Boolean).map((h) => (/^selected$/i.test(h) ? ui.selected() : T.resolve(h))).filter(Boolean).map((x) => String(x.id));
      let r = null;
      try { r = await ui.act(name, { ...input, id: l ? String(l.id) : undefined }); } catch (e) { return JSON.stringify({ error: String(e.message || e).slice(0, 120) }); }
      if (name === 'start_route' || name === 'fast_travel') note(1500);
      if (name === 'show_on_map' || name === 'set_filters') note(900);
      // game tools that report what really happened (what got lit up) answer with that
      return JSON.stringify(name === 'start_route' ? { ok: true, started: true, to: label(l, ctx.insights.row(l.id)) } : r || { ok: true });
    };
    const out = {};
    for (const n of ['get_property', 'compare', 'find_alternatives', 'nearby', 'monthly_cost', 'affordability_check', 'drive_to_my_places', 'room_fit', 'same_money_other_city']) out[n] = data(n);
    for (const n of ['start_route', 'set_filters', 'show_on_map', 'start_mission', 'show_card', 'remember_preference', 'pin_place', 'open_compare', 'set_sun_time', 'print_shortlist', 'measure', 'fast_travel']) out[n] = game(n);
    return out;
  }

  async function start(opts = {}) {
    if (L.conv || L.status === 'connecting') return true;
    L.status = 'connecting'; L.tools = []; L.heard = ''; L.said = ''; pub();
    ui.show(); ui.setState('thinking'); ui.status('Connecting');
    try {
      const res = await fetch('/api/maya/session' + (opts.text ? '?text=1' : ''), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('session ' + res.status);
      const { token, signedUrl } = await res.json();
      const { Conversation } = await import('@elevenlabs/client');
      const voiceId = ctx.settings?.voiceId || undefined;
      // she introduces herself on the first call of a game only; after that a short line opens the call
      const again = ui.S.introduced ? { agent: { firstMessage: ["I'm here. Go ahead.", "I'm listening.", 'Go ahead.', "What's on your mind?"][L.calls++ % 4] } } : null;
      const ov = { ...(again || {}), ...(opts.text ? { conversation: { textOnly: true } } : voiceId ? { tts: { voiceId } } : {}) };
      L.conv = await Conversation.startSession({
        ...(opts.text ? { signedUrl, connectionType: 'websocket', textOnly: true } : { conversationToken: token, connectionType: 'webrtc' }),
        ...(Object.keys(ov).length ? { overrides: ov } : {}),
        stripAudioTags: true,
        clientTools: clientTools(),
        onConnect: () => { ui.S.introduced = true; L.status = 'connected'; L.startedAt = L.lastActivity = performance.now(); ui.setState('listening'); ui.status('Live · just talk'); ctx.audio.chime(); pub(); note(50); },
        onDisconnect: () => stopped(),
        onError: (message) => { console.warn('[maya live]', message); },
        onModeChange: ({ mode }) => { L.mode = mode; L.lastActivity = performance.now(); if (L.status === 'connected') { ui.setState(mode === 'speaking' ? 'talking' : 'listening'); ui.status(mode === 'speaking' ? 'Talking · cut in any time' : 'Live · just talk'); } pub(); },
        onMessage: ({ message, source }) => {
          L.lastActivity = performance.now();
          if (!message) return;
          L.log.push({ who: source === 'user' ? 'user' : 'maya', text: message, at: Math.round(performance.now()) });
          if (source === 'user') { L.heard = message; ui.bubble(`“${message}”`, 'you'); ctx.emit('heard', message); } else { L.said = message; ui.bubble(message); ui.S.history.push({ role: 'assistant', content: message }); ui.S.source = 'agent'; }
          pub();
        },
        onUnhandledClientToolCall: (c) => console.warn('[maya live] no handler for tool', c?.tool_name),
      });
      if (!opts.text) L.conv.setVolume({ volume: ctx.settings?.volume ?? 1 });
      if (!opts.text) ui.level(() => (L.conv && L.mode === 'speaking' ? Math.min(1, L.conv.getOutputVolume() * 2.2) : 0));
      L.failed = 0;
      pub();
      return true;
    } catch (e) {
      console.warn('[maya live] could not start, using push to talk:', String(e.message || e).slice(0, 160));
      L.failed++; L.conv = null; L.status = 'off'; ui.level(null); ui.setState('idle'); ui.status(null); pub();
      ctx.hud.toast(/NotAllowed|Permission|denied/i.test(String(e)) ? 'Mic blocked. Allow the microphone for this page' : 'Live voice is not reachable. Hold V to talk instead', 3200);
      return false;
    }
  }
  function stopped() {
    if (L.status === 'off') return;
    L.conv = null; L.status = 'off'; ui.level(null); ui.setState('idle'); ui.status(null);
    setTimeout(() => { if (L.status === 'off') ui.bubble(''); }, 2500);
    pub();
  }
  async function stop() {
    const c = L.conv;
    if (!c) return;
    try { await c.endSession(); } catch { /* already closed */ }
    stopped();
    ctx.audio.blip(520, 0.1);
  }
  const toggle = () => (L.conv || L.status === 'connecting' ? stop() : start());

  // keep her current: selection, the down payment and solar switches, missions, pins, city
  ctx.on('reveal-panel', () => note(300));
  ctx.on('select', (l) => { if (!l) note(600); });
  ctx.on('mission', () => note(900));
  ctx.on('near-listing', () => note(1200));
  ctx.on('client-mission', () => note());
  ctx.on('client-result', () => note());
  ctx.on('buyer', () => note());
  ctx.on('saved', () => note(800));
  ctx.on('city', () => { if (L.conv) note(1500); });
  ctx.on('settings', (s) => { if (L.conv) L.conv.setVolume({ volume: s.volume ?? 1 }); if (s.liveVoice === false && L.conv) stop(); pub(); });
  ctx.on('tour-enter', () => note(500));
  // hang up after a long silence, so an open mic is never left running
  ctx.on('update', () => { if (L.conv && L.status === 'connected' && performance.now() - L.lastActivity > 75000) { stop(); ctx.hud.toast('Maya hung up after a quiet minute. Press V to talk again', 3200); } });
  ctx.on('key', (code) => { if (code === 'Escape' && L.conv && ctx.state === 'play' && !ctx.reveal?.open) stop(); });
  addEventListener('beforeunload', () => { try { L.conv?.endSession(); } catch { /* closing */ } });
  pub();

  return {
    available, start, stop, toggle,
    get active() { return !!L.conv && L.status === 'connected'; },
    get connecting() { return L.status === 'connecting'; },
    // typed text, the B key and the phone's spoken lines go to her as a user message
    send(text) { if (!L.conv) return false; L.lastActivity = performance.now(); ui.bubble(`“${text}”`, 'you'); L.conv.sendUserMessage(text); return true; },
    note,
    state: L,
  };
}
