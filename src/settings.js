// Settings (U or the gear in the dock): volume, Maya's voice, units, reduced motion, caption
// size and the graphics preset. Kept in this browser. Also the first run tutorial with Maya:
// five short steps, about 20 seconds, skippable.
import { icon } from './icons.js';

const DEFAULTS = { volume: 0.8, captions: true, voiceOff: false, liveVoice: true, revealPace: 'guided', tourGuide: 'auto', voiceId: '', units: 'metric', reducedMotion: null, capSize: 'm', quality: 'auto' };
const CAP = { s: '17px', m: '21px', l: '27px' };

export function loadSettings() {
  let s = { ...DEFAULTS };
  try { s = { ...s, ...JSON.parse(localStorage.getItem('gpa-settings') || '{}') }; } catch { /* private mode */ }
  if (s.reducedMotion == null) s.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return s;
}
export function formatDistance(m, units) {
  if (m == null) return '';
  if (units === 'imperial') return m >= 320 ? (m / 1609.34).toFixed(1) + ' mi' : Math.round((m * 3.28084) / 10) * 10 + ' ft';
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
}

export function initSettings(ctx) {
  const S = ctx.settings;
  const el = document.createElement('div');
  el.id = 'settings';
  document.body.append(el);
  let open = false, voiceList = null;
  function apply() {
    document.body.classList.toggle('reduced-motion', !!S.reducedMotion);
    document.body.classList.toggle('captions-off', S.captions === false);
    document.documentElement.style.setProperty('--cap', CAP[S.capSize] || CAP.m);
    ctx.audio.setVolume?.(S.volume);
    try { localStorage.setItem('gpa-settings', JSON.stringify(S)); } catch { /* private mode */ }
    ctx.emit('settings', S);
  }
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, label]) => `<button data-set="${key}" data-v="${v}" class="${String(S[key]) === String(v) ? 'on' : ''}" aria-pressed="${String(S[key]) === String(v)}">${label}</button>`).join('')}</div>`;
  function render() {
    el.innerHTML = `<div class="bcard" role="dialog" aria-label="Settings"><h2>${icon('settings', 20)}Settings</h2>
      <div class="srow"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${S.volume}" data-vol aria-label="Volume"/><small><kbd>N</kbd> mutes</small></div>
      <div class="srow"><span>Maya's voice</span>${seg('voiceOff', [['false', 'On'], ['true', 'Captions only']])}</div>
      ${ctx.config.mayaAgent ? `<div class="srow"><span>Talking to Maya</span>${seg('liveVoice', [['true', 'Live conversation'], ['false', 'Hold V to talk']])}</div>` : ''}
      <div class="srow voicerow"><span>Which voice</span><select data-voice aria-label="Maya's voice"><option value="">Loading voices...</option></select><button class="act" data-a="hear">Hear it</button></div>
      <div class="srow"><span>Captions</span>${seg('captions', [['true', 'On'], ['false', 'Off']])}<small>${S.captions === false && S.voiceOff ? 'Voice is off too: nothing she says will show' : "Maya's words on screen"}</small></div>
      <div class="srow"><span>Caption size</span>${seg('capSize', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])}</div>
      <div class="srow"><span>Distances</span>${seg('units', [['metric', 'Meters'], ['imperial', 'Feet and miles']])}</div>
      <div class="srow"><span>Home reveal</span>${seg('revealPace', [['guided', 'Step by step'], ['quick', 'Quick']])}</div>
      <div class="srow"><span>Room tours</span>${seg('tourGuide', [['auto', 'Maya leads'], ['ask', 'Ask me first']])}</div>
      <div class="srow"><span>Motion</span>${seg('reducedMotion', [['false', 'Full'], ['true', 'Reduced']])}</div>
      <div class="srow"><span>Graphics</span>${seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']])}<small>${ctx.quality.label} now${S.quality !== (ctx.quality._asked || 'auto') ? ' · reloads to apply' : ''}</small></div>
      <div class="ract"><button class="act" data-a="tutorial">${icon('sparkles', 15)}Replay the tutorial</button><button class="act primary" data-a="close">Done <kbd>Esc</kbd></button></div></div>`;
    el.querySelector('[data-vol]').addEventListener('input', (e) => { S.volume = Number(e.target.value); apply(); ctx.audio.click?.(); });
    for (const b of el.querySelectorAll('[data-set]')) b.addEventListener('click', () => {
      const k = b.dataset.set, v = b.dataset.v;
      S[k] = v === 'true' ? true : v === 'false' ? false : v;
      apply(); render();
      if (k === 'units') ctx.panel?.refresh();
      if (k === 'quality') { try { if (v === 'auto') localStorage.removeItem('gpa-quality'); else localStorage.setItem('gpa-quality', v); } catch { /* private mode */ } if ((ctx.quality.tier !== v && v !== 'auto') || v === 'auto') ctx.hud.toast('Graphics preset applies after a reload (F5)', 3000); }
    });
    el.querySelector('[data-a="close"]').addEventListener('click', hide);
    el.querySelector('[data-a="tutorial"]').addEventListener('click', () => { hide(); tutorial(true); });
    // the voices on the ElevenLabs account: stock ones and any added to "My Voices"
    const sel = el.querySelector('[data-voice]');
    const fill = (j) => {
      if (!j?.voices?.length) { sel.innerHTML = '<option value="">Browser voice (no ElevenLabs voice available)</option>'; sel.disabled = true; return; }
      const cur = S.voiceId || j.current;
      const group = (kind) => { const list = j.voices.filter((v) => v.kind === kind); return list.length ? `<optgroup label="${kind}">${list.map((v) => `<option value="${v.id}" ${v.id === cur ? 'selected' : ''}>${v.name}${v.about ? ' · ' + v.about : ''}</option>`).join('')}</optgroup>` : ''; };
      sel.innerHTML = group('My voices') + group('Stock');
    };
    if (voiceList) fill(voiceList); else fetch('/api/maya/voices').then((r) => (r.ok ? r.json() : null)).then((j) => { voiceList = j; fill(j); }).catch(() => fill(null));
    sel.addEventListener('change', () => { S.voiceId = sel.value; apply(); ctx.maya?.say("Hi, I'm Maya. This is how I sound now."); });
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    el.querySelector('[data-a="hear"]').addEventListener('click', () => ctx.maya?.say("Hi, I'm Maya. Ask me about any home and I'll tell you what the listing doesn't."));
  }
  function show() { if (ctx.state !== 'play') return; open = true; ctx.state = 'settings'; render(); el.classList.add('show'); }
  function hide() { if (!open) return; open = false; if (el.contains(document.activeElement)) document.activeElement.blur(); el.classList.remove('show'); if (ctx.state === 'settings') ctx.state = 'play'; }
  ctx.on('key', (code) => { if (code === 'KeyU') { if (open) hide(); else if (ctx.state === 'play' && !ctx.hud.choosing) show(); } else if (code === 'Escape' && open) hide(); });

  // ---- first run tutorial
  const coach = document.createElement('div');
  coach.id = 'coach';
  ctx.hud.root.append(coach);
  const STEPS = [
    ['car', 'Drive', 'Drive with W A S D or the arrow keys. Space is the handbrake.'],
    ['map-pin', 'Select', 'Click any marker, or pull up to a home and press E, to see what living there is really like.'],
    ['sparkles', 'Reveal', 'The reveal shows walk times, the true monthly cost, solar and risk. Every card has an i that says where its numbers come from.'],
    ['house', 'Walk in', 'Press E again to walk inside the real 3D scan. R is a tape measure in there.'],
    ['inbox', 'Missions', 'Press I for clients who need a home, or hold V and ask me anything.'],
  ];
  let tToken = 0;
  async function tutorial(force) {
    let seen = false;
    try { seen = localStorage.getItem('gpa-onboarded') === '1'; } catch { /* private mode */ }
    if (seen && !force) return;
    const my = ++tToken;
    const fast = ctx.params.has('demofast');
    for (let i = 0; i < STEPS.length && my === tToken; i++) {
      const [ic, title, text] = STEPS[i];
      coach.innerHTML = `<div class="ccard"><span class="cic">${icon(ic, 20)}</span><div><b>${i + 1} of ${STEPS.length} · ${title}</b><p>${text}</p></div><button class="act ghost" data-skip>Skip <kbd>Esc</kbd></button></div><div class="cdots">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>`;
      coach.classList.add('show');
      coach.querySelector('[data-skip]').addEventListener('click', end);
      window.__gpa.tutorial = { step: i + 1, of: STEPS.length };
      ctx.maya?.say(text, { caption: false });
      await new Promise((r) => setTimeout(r, fast ? 250 : 4000));
    }
    if (my === tToken) end();
  }
  function end() {
    tToken++;
    coach.classList.remove('show');
    try { localStorage.setItem('gpa-onboarded', '1'); } catch { /* private mode */ }
    window.__gpa.tutorial = { step: 0, done: true };
  }
  ctx.on('key', (code) => { if (code === 'Escape' && coach.classList.contains('show')) { ctx.maya?.interrupt(); end(); } });
  ctx.on('play-start', () => { if (!ctx.params.has('demo')) setTimeout(() => tutorial(false), 900); });
  ctx.on('boot', () => { if (ctx.params.has('tutorial')) setTimeout(() => tutorial(true), 1200); });

  apply();
  return { open: show, close: hide, tutorial, apply };
}
