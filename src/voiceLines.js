// Maya's own wording for the lines the game would otherwise say with stock text.
// request(kind, lines) posts the stock lines to /api/maya/say and collects what the model
// writes as it streams in. The handle answers at once: get(key) is the model's line when it has
// arrived and passed the fact check (src/lines.js), null otherwise, and the caller then says
// the stock line. So nothing waits on the network, and with the model off, the server down or
// the internet gone the game simply keeps its stock lines (which also vary, see pick()).
import { keepsFacts } from './lines.js';

export function initVoiceLines(ctx) {
  // the last things she said, sent along so the model does not write them again
  let said = [];
  try { said = JSON.parse(localStorage.getItem('gpa-said') || '[]').slice(-12); } catch { /* private mode */ }
  const stats = { asked: 0, written: 0, dropped: 0, firstMs: null, ms: null, failed: null };
  const pub = () => { window.__gpa.voiceLines = { ...stats, recent: said.slice(-4) }; };
  const on = () => !!ctx.config.maya && !ctx.params.has('mayascript') && navigator.onLine !== false;

  function remember(text) {
    if (!text) return;
    said.push(String(text).slice(0, 200));
    while (said.length > 12) said.shift();
    try { localStorage.setItem('gpa-said', JSON.stringify(said)); } catch { /* private mode */ }
  }

  // lines: [{ key, stock, must, max }]
  function request(kind, lines, opts = {}) {
    const got = new Map(), ac = new AbortController();
    const h = { get: (key) => got.get(key) || null, has: (key) => got.has(key), get size() { return got.size; }, cancel: () => ac.abort(), done: Promise.resolve(null), live: false };
    if (!on() || !lines.length) return h;
    h.live = true;
    const byKey = new Map(lines.map((l) => [l.key, l]));
    const started = performance.now();
    stats.asked = lines.length; stats.written = 0; stats.dropped = 0; stats.firstMs = null; stats.ms = null; stats.failed = null;
    const timer = setTimeout(() => ac.abort(), 14000);
    h.done = (async () => {
      try {
        const res = await fetch('/api/maya/say', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ kind, intro: !!opts.intro, prefs: (ctx.maya?.prefs || []).map((p) => p.text), avoid: said.slice(-10), lines: lines.map((l) => ({ key: l.key, text: l.stock, must: l.must || [], max: l.max || 30 })) }),
        });
        if (!res.ok || !(res.headers.get('content-type') || '').includes('event-stream')) { stats.failed = 'scripted'; return h; }
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(chunk)?.[1], data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (!ev || !data) continue;
            const d = JSON.parse(data);
            if (ev === 'line') {
              const src = byKey.get(d.key);
              // checked again here: the browser never says a model line it has not checked itself
              if (src && typeof d.text === 'string' && keepsFacts(src.stock, d.text, { must: src.must, max: src.max })) {
                got.set(d.key, d.text);
                stats.written = got.size;
                if (stats.firstMs == null) stats.firstMs = Math.round(performance.now() - started);
              } else stats.dropped++;
            } else if (ev === 'done') stats.dropped += d.dropped || 0;
            else if (ev === 'fallback') stats.failed = d.reason || 'fallback';
            pub();
          }
        }
      } catch (e) { stats.failed = ac.signal.aborted ? 'cancelled' : 'network'; }
      clearTimeout(timer);
      stats.ms = Math.round(performance.now() - started);
      pub();
      return h;
    })();
    return h;
  }

  // What she has already said about each home in the last twenty minutes (its price, the places
  // nearby, the monthly cost, ...), so the arrival line, the reveal and the tour inside do not
  // tell the buyer the same thing three times.
  const told = new Map();
  const TOLD_MS = 20 * 60 * 1000;
  function tell(id, ...topics) {
    if (id == null) return;
    const m = told.get(String(id)) || new Map();
    for (const t of topics) m.set(t, performance.now());
    told.set(String(id), m);
    window.__gpa.told = Object.fromEntries([...told].map(([k, v]) => [k, [...v.keys()]]));
  }
  function toldAbout(id) {
    const m = told.get(String(id)), now = performance.now();
    return new Set(m ? [...m].filter(([, at]) => now - at < TOLD_MS).map(([t]) => t) : []);
  }

  pub();
  return { request, remember, on, tell, toldAbout, get recent() { return said.slice(-10); } };
}
