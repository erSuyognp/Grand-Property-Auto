// Maya in the game: an illustrated avatar at the bottom center, live captions, a streamed
// voice, and the bridge between her tools and the game. Hold V and talk; start talking while
// she speaks and she stops at once. If the model or the voice fails she falls back to scripted
// lines built from the same data, and to the browser voice, so the demo never goes silent.
import { makeTools, label } from './mayaTools.js';
import { scripted, extractPrefs, PEOPLE_RE } from './mayaScript.js';
import { parseMission } from './parser.js';
import { dataBase } from './data.js';
import { icon } from './icons.js';
import { initMayaLive } from './mayaLive.js';
import { money } from './format.js';

const AVATAR = `<svg viewBox="0 0 120 120" width="88" height="88" aria-hidden="true">
  <defs><clipPath id="mclip"><circle cx="60" cy="60" r="56"/></clipPath>
  <linearGradient id="mbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb37a"/><stop offset="1" stop-color="#ff5a7a"/></linearGradient></defs>
  <g clip-path="url(#mclip)"><rect width="120" height="120" fill="url(#mbg)"/>
    <path d="M22 128c2-26 18-36 38-36s36 10 38 36z" fill="#1d3557"/><path d="M50 92l10 14 10-14-10-6z" fill="#f7efe6"/>
    <path d="M28 62c-4-30 12-46 32-46s36 16 32 46c-2 16-4 26-8 34H36c-4-8-6-18-8-34z" fill="#3b2a3f"/>
    <rect x="53" y="76" width="14" height="16" rx="6" fill="#e7a983"/>
    <ellipse cx="60" cy="58" rx="22" ry="26" fill="#f2bb97"/>
    <path d="M37 54c0-20 12-30 26-30s22 10 21 28c-8-2-14-8-17-16-5 10-16 17-30 18z" fill="#3b2a3f"/>
    <g class="eyes"><ellipse cx="51" cy="58" rx="3" ry="3.6" fill="#2b2230"/><ellipse cx="69" cy="58" rx="3" ry="3.6" fill="#2b2230"/></g>
    <path d="M45 51q6-4 11 0M64 51q6-4 11 0" stroke="#3b2a3f" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="45" cy="67" rx="5" ry="3" fill="#ff8f8f" opacity=".45"/><ellipse cx="75" cy="67" rx="5" ry="3" fill="#ff8f8f" opacity=".45"/>
    <ellipse class="mouth" cx="60" cy="72" rx="7" ry="2" fill="#8c2f39"/>
  </g><circle cx="60" cy="60" r="56" fill="none" stroke="#fff" stroke-width="4"/></svg>`;

export const MAYA_AVATAR = AVATAR;

export function initMaya(ctx) {
  const el = document.createElement('div');
  el.id = 'maya';
  el.innerHTML = `<div class="malts" role="list"></div><div class="mbubble" role="status" aria-live="polite"></div>
    <div class="mrow"><button class="mava" aria-label="Maya, your agent. Hold V to talk to her">${AVATAR}<span class="mdots"><i></i><i></i><i></i></span></button>
    <div class="mside"><b>Maya</b><span class="mstate">Hold <kbd>V</kbd> to talk</span><ul class="mprefs" aria-label="What Maya remembers"></ul></div></div>`;
  ctx.hud.root.append(el);
  const q = (s) => el.querySelector(s);
  const muted = () => ctx.params.has('mute') || ctx.muteVoice || ctx.settings?.voiceOff;
  const S = { state: 'idle', prefs: [], history: [], offered: null, busy: 0, lastLatency: null, lastTools: [], source: null, caption: '', alts: [] };
  try { S.prefs = JSON.parse(sessionStorage.getItem('gpa-maya-prefs') || '[]'); } catch { /* fresh session */ }
  const pub = () => { window.__gpa.maya = { state: S.state, prefs: S.prefs.map((p) => p.text), tools: S.lastTools, source: S.source, voice: S.lastVoice || null, caption: S.caption, latencyMs: S.lastLatency, offered: S.offered?.id || null, alts: S.alts.map((l) => l.id), marked: (S.marked || []).map((l) => l.id), introduced: !!S.introduced, act: (n, i) => act(n, i), say: (t) => hear(t) }; };
  let statusText = null, liveLevel = null, live = null;
  const idleHint = () => (live?.available() ? 'Press <kbd>V</kbd> to talk' : 'Hold <kbd>V</kbd> to talk');
  function setState(s) { S.state = s; el.dataset.state = s; q('.mstate').innerHTML = statusText || { idle: idleHint(), listening: 'Listening', thinking: 'Thinking', talking: 'Talking' }[s]; el.classList.toggle('live', !!live?.state.conv); pub(); }
  function renderPrefs() {
    q('.mprefs').innerHTML = S.prefs.slice(-6).map((p, i) => `<li>${p.text}<button data-i="${i}" aria-label="Forget ${p.text}">×</button></li>`).join('');
    for (const b of el.querySelectorAll('.mprefs button')) b.addEventListener('click', () => { S.prefs.splice(S.prefs.length - Math.min(6, S.prefs.length) + Number(b.dataset.i), 1); savePrefs(); });
    pub();
  }
  function savePrefs() { try { sessionStorage.setItem('gpa-maya-prefs', JSON.stringify(S.prefs)); } catch { /* private mode */ } renderPrefs(); }
  function remember(p) {
    const item = typeof p === 'string' ? { key: p.toLowerCase().split(' ')[0] + p.length, text: p, ...(extractPrefs(p)[0] || {}), ...{ text: p } } : p;
    const i = S.prefs.findIndex((x) => x.key === item.key || x.text.toLowerCase() === item.text.toLowerCase());
    if (i >= 0) S.prefs[i] = item; else S.prefs.push(item);
    savePrefs();
  }

  // ---- the local data view the scripted brain and the tools read
  let T = null;
  function tools() {
    if (T && T.__city === ctx.city) return T;
    const base = dataBase(ctx.city);
    const db = {
      city: ctx.city, listings: ctx.world.listings, money: ctx.insights.money,
      row: (id) => ctx.insights.row(id), ins: (id) => ctx.insights.get(id),
      rooms: async (l) => {
        const m = (l.matterportIds || [])[0];
        if (!m) return null;
        try { const j = await (await fetch(`${base}mp/${m}.json`)).json(); return (j.rooms || []).filter((r) => r.area > 2 && r.label && !/other|stair|closet/i.test(r.label)).map((r) => ({ label: r.label, areaSqft: Math.round(r.area * 10.764), longFt: Math.round(Math.sqrt(r.area * 1.5) * 3.281) })); } catch { return null; }
      },
      other: async () => {
        const oc = ctx.city === 'la' ? 'houston' : ctx.city === 'houston' ? 'la' : null;
        if (!oc) return null;
        try { const rows = await (await fetch(`/data/${oc}/insights/index.json`)).json(); return { city: oc, name: oc === 'la' ? 'Los Angeles' : 'Houston', rows }; } catch { return null; }
      },
    };
    T = makeTools(db);
    T.__city = ctx.city; T.__ins = db.ins; T.__row = db.row;
    return T;
  }
  const extra = () => ({ profile: ctx.buyer?.profile || null, places: ctx.buyer?.places || [] });

  // ---- voice out: a queue of sentences, each streamed from the server; browser voice as fallback
  let ac = null, analyser = null, levelBuf = null, queue = [], playing = null, speakToken = 0, firstAudioAt = 0, heardAt = 0, synthTimer = 0;
  function level() {
    if (liveLevel) return liveLevel();
    if (playing?.synth) return 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 70)) * (0.5 + 0.5 * Math.sin(performance.now() / 190));
    if (!analyser || !playing) return 0;
    analyser.getByteTimeDomainData(levelBuf);
    let s = 0;
    for (let i = 0; i < levelBuf.length; i++) { const v = (levelBuf[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / levelBuf.length) * 5);
  }
  const mouth = q('.mouth');
  ctx.on('post', () => { if (S.state === 'talking' || liveLevel) { const m = level(); mouth.setAttribute('ry', (2 + m * 8).toFixed(1)); mouth.setAttribute('rx', (7 - m * 1.5).toFixed(1)); } });
  function bubble(text, who = 'maya') {
    const b = q('.mbubble');
    if (!text) { b.classList.remove('show'); return; }
    b.textContent = text; b.dataset.who = who; b.classList.add('show');
    S.caption = text; pub();
  }
  // When the voice service keeps refusing (most often: the account's credits are used up), she
  // stops asking it for a few minutes and speaks with the browser voice at once, so every
  // sentence does not first wait for a failure.
  let ttsFails = 0, ttsOffUntil = 0;
  function ttsFailed() {
    if (++ttsFails < 2 || performance.now() < ttsOffUntil) return;
    ttsOffUntil = performance.now() + 180000; ttsFails = 0;
    fetch('/api/maya/tts/status').then((r) => r.json()).then((j) => ctx.hud.toast(j.reason === 'quota' ? `Maya's ${j.provider === 'openai' ? 'OpenAI' : 'ElevenLabs'} credits are used up. Using the browser voice` : "Maya's voice service is not answering. Using the browser voice", 4200)).catch(() => {});
  }
  const voiceOn = () => !muted() && !!ctx.config.mayaTts && performance.now() >= ttsOffUntil;
  function makeAudio(text) {
    const a = new Audio();
    a.preload = 'auto';
    a.src = `/api/maya/tts?text=${encodeURIComponent(text)}${ctx.settings?.voiceId ? '&voice=' + encodeURIComponent(ctx.settings.voiceId) : ''}`;
    a.load();
    return a;
  }
  // sentences whose voice is already on its way (see preload below)
  const warm = new Map();
  function fetchAudio(text) {
    if (!voiceOn()) return null;
    const ready = warm.get(text);
    if (ready) { warm.delete(text); return ready; }
    return makeAudio(text);
  }
  // Ask for the voice of a line before it is needed, so there is no pause when she gets to it
  // (the home reveal does this with the next step's line while she says the current one).
  function preload(text) {
    if (!voiceOn() || !text) return;
    const sp = splitter((s) => {
      s = s.trim();
      if (!s || warm.has(s)) return;
      warm.set(s, makeAudio(s));
      if (warm.size > 6) { const k = warm.keys().next().value, old = warm.get(k); warm.delete(k); try { old.removeAttribute('src'); old.load(); } catch { /* gone */ } }
    });
    sp.push(String(text) + ' '); sp.flush();
  }
  function enqueue(text, { show = true } = {}) {
    text = text.trim();
    if (!text) return;
    queue.push({ text, show, audio: fetchAudio(text) });
    if (!playing) next();
  }
  async function next() {
    const token = speakToken;
    const item = queue.shift();
    if (!item) { playing = null; if (S.state === 'talking') { setState('idle'); mouth.setAttribute('ry', '2'); setTimeout(() => { if (S.state === 'idle' && !playing) bubble(''); }, 3200); } ctx.emit('maya-quiet'); return; }
    playing = item;
    const a = item.audio || null;
    if (token !== speakToken) return;
    setState('talking');
    if (item.show) bubble(item.text);
    const started = () => { S.lastVoice = item.synth || !item.el ? 'browser' : 'stream'; if (!firstAudioAt && heardAt) { firstAudioAt = performance.now(); S.lastLatency = Math.round(firstAudioAt - heardAt); console.info(`[maya] first spoken word ${S.lastLatency} ms after the question`); pub(); } };
    const done = () => { if (token === speakToken && playing === item) { playing = null; next(); } };
    const browserVoice = () => {
      if (muted() || !window.speechSynthesis) { started(); item.synth = true; setTimeout(done, ctx.params.has('demofast') ? 60 : Math.max(900, item.text.length * 45)); return; }
      try {
        const u = new SpeechSynthesisUtterance(item.text);
        const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
        u.voice = voices.find((v) => v.localService && /aria|jenny|zira|samantha|natural|female/i.test(v.name)) || voices.find((v) => v.localService) || null;
        u.rate = 1.05;
        item.synth = true;
        u.onstart = started; u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        clearTimeout(synthTimer);
        synthTimer = setTimeout(done, Math.max(2500, item.text.length * 95)); // some browsers never fire onend
      } catch { started(); setTimeout(done, Math.max(1200, item.text.length * 55)); }
    };
    if (a) {
      item.el = a;
      let failed = false;
      const fail = () => { if (failed || token !== speakToken) return; failed = true; item.el = null; try { a.pause(); } catch { /* gone */ } ttsFailed(); browserVoice(); };
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
        if (!analyser) { analyser = ac.createAnalyser(); analyser.fftSize = 256; levelBuf = new Uint8Array(analyser.fftSize); analyser.connect(ac.destination); }
        ac.createMediaElementSource(a).connect(analyser);
      } catch { /* plays without the mouth meter */ }
      a.volume = ctx.settings?.volume ?? 1;
      a.onplaying = () => { ttsFails = 0; started(); }; a.onended = done; a.onerror = fail;
      if (a.error) fail(); else a.play().catch(fail);
      setTimeout(() => { if (!failed && token === speakToken && playing === item && a.readyState < 2 && a.currentTime === 0) fail(); }, 6000); // nothing arrived
    } else browserVoice();
  }
  function interrupt() {
    speakToken++;
    for (const it of queue) { if (it.audio) { try { it.audio.removeAttribute('src'); it.audio.load(); } catch { /* gone */ } } }
    queue = [];
    if (playing?.el) { try { playing.el.pause(); } catch { /* gone */ } }
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
    clearTimeout(synthTimer);
    playing = null;
    if (abort) { abort.abort(); abort = null; }
    if (S.state === 'talking' || S.state === 'thinking') setState('idle');
  }

  // ---- what her tools do in the game
  const byId = (id) => ctx.world.listings.find((l) => String(l.id) === String(id));
  async function act(name, input = {}) {
    S.lastTools.push(name);
    if (name === 'show_card') ctx.panel.flash(input.cardName);
    else if (name === 'remember_preference' && input.preference) remember(String(input.preference).slice(0, 40));
    else if (name === 'alternatives') { S.alts = (input.ids || []).map(byId).filter(Boolean); S.offered = S.alts[0] || null; renderAlts(input.why || []); }
    else if (name === 'start_route') { const l = byId(input.id) || S.offered; if (l) { S.offered = null; renderAlts([]); S.alts = []; ctx.reveal.close(); ctx.missions.goTo(l, true); ctx.emit('maya-route', l); } }
    else if (name === 'set_filters' && input.query) {
      ctx.reveal.close();
      S.marked = [];
      // the search answers with what it really lit up, so she never claims a mark that is not there
      const done = ctx.missions.handle(input.query).then((p) => {
        if (!p || p.action || p.reset || (p.empty && !p.relative)) return { ok: false, error: 'That did not read as a home search, nothing was lit up. Ask the player for a budget, bedrooms or a feature.' };
        const M = ctx.missions.state;
        if (!M.active || !M.top.length) return { ok: false, error: 'No home matches, nothing was lit up' };
        const TT = tools();
        return { ok: true, exactMatches: M.exact, litUp: M.top.map((l) => ({ home: TT.alias(l.id), label: label(l, ctx.insights.row(l.id)) })), routeTo: TT.alias(M.target.id),
          note: M.exact ? 'These glow in the world and are ringed on the minimap and the big map (key M). A gold line on the road leads to the first one.' : 'Nothing matches everything, so the closest fits are lit up instead. Say that.' };
      }).catch(() => ({ ok: false, error: 'The search failed, nothing was lit up' }));
      pub();
      return Promise.race([done, new Promise((r) => setTimeout(() => r({ ok: true, note: 'The search is still running; the game will light up the matches in a moment. Do not state a count.' }), 6500))]);
    }
    else if (name === 'show_on_map') {
      const ls = [...new Set((input.ids || []).map(byId).filter(Boolean))].slice(0, 6);
      if (!ls.length) return { error: 'No such home, nothing was marked' };
      S.alts = []; q('.malts').classList.remove('show');
      for (const l of ls) if (!ctx.listingsSys.visible[l.kind]) ctx.listingsSys.setVisible(l.kind, true);
      const mt = ctx.missions.active ? ctx.missions.target : null; // a route in progress keeps its target
      ctx.listingsSys.setHighlights([...ls.map((l) => l.id), ...(mt ? [mt.id] : [])], mt || ls[0]);
      S.marked = ls;
      ctx.audio.chime?.();
      ctx.hud.toast(`${ls.length === 1 ? 'Home' : ls.length + ' homes'} lit up in gold · M opens the map`, 3200);
      pub();
      return { ok: true, marked: ls.length, homes: ls.map((l) => label(l, ctx.insights.row(l.id))), note: 'Their buildings glow gold and their dots are ringed on the minimap and the big map (key M).' };
    }
    else if (name === 'start_mission') { if (input.missionId && ctx.clients?.accept(String(input.missionId))) { /* accepted */ } else ctx.clients?.open(); }
    else if (name === 'pin_place') ctx.buyer?.pinByName(input.name, input.where);
    else if (name === 'set_profile') ctx.buyer?.setProfile(input);
    else if (name === 'open_compare') { if (!ctx.compare.open) ctx.emit('key', 'Tab', null); }
    else if (name === 'fast_travel' && ctx.cities.includes(input.city) && input.city !== ctx.city) ctx.loadCity(input.city);
    else if (name === 'other_city') ctx.buyer?.showOtherCity?.(input);
    else if (name === 'set_sun_time' && ctx.reveal?.listing) { const h = Math.max(6, Math.min(20, Number(input.hour) || 15)); ctx.buyer?.applySun(ctx.reveal.listing, h); ctx.panel.flash('energy'); const s = ctx.panel.el.querySelector('[data-sun]'); if (s) { s.value = h; ctx.panel.el.querySelector('.sunline').textContent = ctx.buyer.sunLine(ctx.reveal.listing, h); } }
    else if (name === 'print_shortlist') { if (!ctx.compare.open) ctx.emit('key', 'Tab', null); ctx.compare.print(); }
    else if (name === 'measure') ctx.hud.toast('Inside a home press R, then click two points', 3200);
    pub();
  }
  function renderAlts(why) {
    const box = q('.malts');
    box.innerHTML = S.alts.map((l, i) => { const r = ctx.insights.row(l.id) || {}; return `<button role="listitem" data-id="${l.id}"><b>${l.price != null ? money(l.price) : r.rent ? money(r.rent) + '/mo' : ''}</b><span>${l.beds != null ? l.beds + ' bd · ' : ''}${l.sqft ? Number(l.sqft).toLocaleString('en-US') + ' sqft' : l.name || ''}</span><em>${(why[i] || [])[0] || ''}</em><i>${icon('route', 14)}Take me</i></button>`; }).join('');
    box.classList.toggle('show', S.alts.length > 0);
    for (const b of box.children) b.addEventListener('click', () => { interrupt(); act('start_route', { id: b.dataset.id }); say('On it. Follow the gold line.'); });
    ctx.listingsSys.setHighlights(S.alts.length ? S.alts.map((l) => l.id) : null, S.alts[0] || null);
  }

  // ---- brain: the server (Claude with tools) first, scripted lines when that is not available
  let abort = null;
  function splitter(onSentence) {
    let buf = '';
    return { push(d) { buf += d; let m; while ((m = /^([\s\S]{10,}?[.!?]["')]?)\s+/.exec(buf))) { onSentence(m[1]); buf = buf.slice(m[0].length); } }, flush() { if (buf.trim()) onSentence(buf); buf = ''; } };
  }
  async function askServer(text, my) {
    if (!ctx.config.maya || ctx.params.has('mayascript')) return false;
    abort = new AbortController();
    const body = { city: ctx.city, selected: selected()?.id || null, text, history: S.history.slice(-8), prefs: S.prefs.map((p) => p.text), profile: ctx.buyer?.profile || null, places: ctx.buyer?.places || [], saved: ctx.saved.list().map((l) => l.id), mission: ctx.clients?.active ? ctx.clients.brief() : null, offered: S.offered?.id || null, lit: [...(ctx.listingsSys.highlights || [])].slice(0, 6) };
    const timer = setTimeout(() => abort?.abort(), 9000); // nothing back in 9 s: use the script
    let res;
    try { res = await fetch('/api/maya', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal }); } catch { clearTimeout(timer); return false; }
    if (!res.ok || !(res.headers.get('content-type') || '').includes('event-stream')) { clearTimeout(timer); return false; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    const sp = splitter((s) => { if (my === S.busy) enqueue(s); });
    let buf = '', full = '', ok = true, got = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1], data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!ev || !data || my !== S.busy) continue;
          const d = JSON.parse(data);
          if (!got) { got = true; clearTimeout(timer); }
          if (ev === 'text') { full += d.delta; sp.push(d.delta); }
          else if (ev === 'action') act(d.name, d.input);
          else if (ev === 'tool') { S.lastTools.push(d.name); pub(); }
          else if (ev === 'fallback') ok = !!full.trim();
          else if (ev === 'done') S.model = d.model;
        }
      }
    } catch { ok = !!full.trim(); }
    clearTimeout(timer);
    if (my !== S.busy) return true;
    sp.flush();
    if (ok && full.trim()) { S.history.push({ role: 'user', content: text === '__pitch__' ? 'Tell me about this home.' : text }, { role: 'assistant', content: full.trim() }); S.source = 'claude'; }
    return ok && !!full.trim();
  }
  async function askScript(text, my) {
    let out;
    try { out = await scripted(text === '__pitch__' ? 'tell me about this home' : text, { selected: selected(), prefs: S.prefs, offered: S.offered }, tools(), extra()); } catch (e) { console.warn('[maya] script failed', e); out = { text: 'Give me a second, my notes are loading. Try that again.', actions: [], tools: [] }; }
    if (my !== S.busy) return;
    S.source = 'script';
    S.lastTools.push(...out.tools);
    if (out.offered !== undefined) S.offered = out.offered; else if (!/take|yes/.test(text)) S.offered = S.offered;
    for (const a of out.actions) act(a.name, a.input);
    S.history.push({ role: 'user', content: text }, { role: 'assistant', content: out.text });
    const sp = splitter((s) => enqueue(s));
    sp.push(out.text + ' '); sp.flush();
  }
  const selected = () => ctx.reveal?.listing || ctx.listingsSys.near || null;

  async function ask(text) {
    const my = ++S.busy;
    S.lastTools = [];
    heardAt = performance.now(); firstAudioAt = 0;
    setState('thinking');
    el.classList.add('show');
    const ok = await askServer(text, my).catch(() => false);
    if (my !== S.busy) return;
    if (!ok) await askScript(text, my);
    pub();
  }
  // every spoken or typed line arrives here
  async function hear(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    for (const p of extractPrefs(text)) remember(p);
    // in a live conversation typed lines, the B key and the phone's words go straight to her
    if (live?.active) { ctx.emit('heard', text); live.send(text); return; }
    interrupt();
    ctx.emit('heard', text);
    bubble(`“${text}”`, 'you');
    // with no home selected, a plain search goes to the map filters (fast, works offline)
    if (!ctx.reveal?.open && !PEOPLE_RE.test(text) && !/\?|\b(maya|afford|my (work|office|gym|school)|mission|client|compare|better|cheaper)\b/i.test(text)) {
      const p = parseMission(text, {});
      if (p && (p.action || p.reset || p.relative || p.similar || !p.empty)) { setState('idle'); return ctx.missions.handle(text); }
    }
    return ask(text);
  }
  // a line the game itself wants said in her voice (mission narration, tutorial)
  function say(text, opts = {}) {
    if (!text || (live?.state.conv && !opts.force)) return;
    if (opts.interrupt !== false) interrupt();
    el.classList.add('show');
    const sp = splitter((s) => enqueue(s, { show: opts.caption !== false }));
    sp.push(text + ' '); sp.flush();
  }

  ctx.on('key', (code) => {
    if (ctx.state !== 'play' || ctx.hud.choosing) return;
    if (code === 'KeyB' && ctx.reveal?.open) hear('Show me better options');
    // X also clears the homes she lit up (with a route running, the mission's own X does it)
    if (code === 'KeyX' && S.marked?.length && !ctx.missions.active) { S.marked = []; ctx.listingsSys.setHighlights(null, null); ctx.hud.toast('Highlights cleared'); live?.note(); }
  });
  ctx.on('select', (l) => { S.offered = null; if (!l) { if (S.alts.length && !ctx.missions.active) { S.alts = []; renderAlts([]); } } else el.classList.add('show'); });
  ctx.on('city', () => { interrupt(); S.history = []; S.alts = []; S.marked = []; S.offered = null; T = null; q('.malts').classList.remove('show'); bubble(''); });
  q('.mava').addEventListener('pointerdown', (e) => { e.preventDefault(); ctx.voice?.start(); });
  q('.mava').addEventListener('pointerup', () => ctx.voice?.stop());
  q('.mava').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.voice?.openType(); } });
  setState('idle'); renderPrefs();

  live = initMayaLive(ctx, {
    S, tools, extra, selected, act, bubble, setState,
    show: () => el.classList.add('show'),
    status: (t) => { statusText = t; if (!t) setState(S.state); else q('.mstate').innerHTML = t; el.classList.toggle('live', !!t); },
    level: (fn) => { liveLevel = fn; if (!fn) mouth.setAttribute('ry', '2'); },
  });
  ctx.mayaLive = live;
  ctx.on('settings', () => { if (S.state === 'idle') setState('idle'); });
  setState('idle');

  return {
    live,
    level: () => (playing || liveLevel ? level() : 0),
    hear, ask, say, interrupt, remember, act, preload,
    open(pitchNow) { el.classList.add('show'); if (pitchNow) { if (live?.active) { live.send('Tell me about this home.'); return; } interrupt(); ask('__pitch__'); } },
    listening(on) { if (on) { interrupt(); setState('listening'); el.classList.add('show'); } else if (S.state === 'listening') setState('idle'); },
    get state() { return S; },
    get speaking() { return !!playing; },
    get prefs() { return S.prefs; },
    tools,
  };
}
