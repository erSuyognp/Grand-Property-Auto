// Hold V (or the mic button, or the phone's mic) to talk. Live captions show at the bottom
// center while talking. T opens a one line type box as the fallback.
//
// Two ways to hear the player. The browser's own speech recognition gives live captions, but
// it needs the browser vendor's speech service, which many browsers (and embedded ones) cannot
// reach: they answer "network" even when the internet is fine. So when that happens, or when
// the browser has no speech recognition at all, the mic is recorded while V is held and the
// clip is transcribed through the server (/api/stt). Typing (T) is the last resort.
export function initVoice(ctx) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, finalText = '', interim = '', wantStop = false;
  let mode = SR ? 'browser' : 'record';
  try { if (sessionStorage.getItem('gpa-voice-mode') === 'record') mode = 'record'; } catch { /* private mode */ }
  if (ctx.params.get('stt') === 'record') mode = 'record';
  const canRecord = () => !!(ctx.config.stt && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const box = ctx.hud.el.typebox, input = box.querySelector('input');

  const mic = document.createElement('button');
  mic.id = 'micbtn';
  mic.title = 'Hold to talk (V)';
  mic.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Hold <kbd>V</kbd> to talk</span>';
  ctx.hud.root.append(mic);

  const deliver = (text) => { if (text) (ctx.maya ? ctx.maya.hear(text) : ctx.missions.handle(text)); };
  function begin() {
    listening = true; wantStop = false;
    ctx.maya?.listening(true); // barge in: she stops talking the moment you start
    mic.classList.add('on');
    ctx.hud.live('');
    ctx.audio.blip(740, 0.07);
  }
  function end() {
    listening = false;
    mic.classList.remove('on');
    ctx.hud.live(null);
    ctx.maya?.listening(false);
  }

  // ---- 1. the browser's speech recognition (live captions)
  function startBrowser() {
    finalText = ''; interim = '';
    let failed = false;
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      ctx.hud.live((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'network' || e.error === 'service-not-allowed') {
        // the browser cannot reach its speech service: record and transcribe instead, from now on
        failed = true;
        if (canRecord()) {
          mode = 'record';
          try { sessionStorage.setItem('gpa-voice-mode', 'record'); } catch { /* private mode */ }
          const stillHeld = !wantStop;
          try { rec.onend = null; rec.abort(); } catch { /* already stopped */ }
          end();
          if (stillHeld) startRecord(); else ctx.hud.toast('Voice is ready now. Hold V and say it again', 2600);
        } else ctx.hud.toast(e.error === 'network' ? "This browser's speech service is unreachable. Press T to type" : 'Speech is not allowed here. Press T to type', 3200);
      } else if (e.error === 'not-allowed') ctx.hud.toast('Mic blocked. Allow the microphone for this page, or press T to type', 3200);
    };
    rec.onend = () => {
      const text = (finalText + interim).trim();
      end();
      if (!failed) deliver(text);
    };
    rec.start();
    begin();
  }

  // ---- 2. record the mic while V is held, transcribe on release
  let stream = null, recorder = null, chunks = [], startedAt = 0;
  async function startRecord() {
    if (listening) return;
    begin();
    ctx.hud.live('Listening...');
    try {
      stream = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      end();
      ctx.hud.toast('Mic blocked. Allow the microphone for this page, or press T to type', 3200);
      return;
    }
    chunks = [];
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      const held = performance.now() - startedAt;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (held < 350 || blob.size < 1200) { end(); ctx.hud.toast('Hold V while you talk', 1800); return; }
      ctx.hud.live('Got it...', false);
      try {
        const res = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': (blob.type || 'audio/webm').split(';')[0] }, body: blob, signal: AbortSignal.timeout(12000) });
        const j = res.ok ? await res.json() : null;
        end();
        if (j && j.text) { window.__gpa.lastHeard = { text: j.text, via: 'record', ms: j.ms }; deliver(j.text); } else ctx.hud.toast(j ? "I didn't catch that. Try again" : 'Could not transcribe that. Press T to type', 2600);
      } catch { end(); ctx.hud.toast('Could not reach the transcriber. Press T to type', 2800); }
    };
    startedAt = performance.now();
    recorder.start();
    if (wantStop) stopRecord(); // released before the mic was ready
  }
  function stopRecord() {
    if (recorder && recorder.state === 'recording') setTimeout(() => { try { recorder.stop(); } catch { /* already stopped */ } }, 250); // let the last word land
  }

  function start() {
    if (listening) return;
    ctx.maya?.interrupt();
    wantStop = false;
    if (mode === 'record' || !SR) {
      if (canRecord()) startRecord(); else if (SR && mode !== 'browser') { mode = 'browser'; start(); } else openType();
      return;
    }
    try { startBrowser(); } catch { end(); if (canRecord()) { mode = 'record'; startRecord(); } else openType(); }
  }
  function stop() {
    if (wantStop) return;
    wantStop = true;
    if (!listening) return;
    if (recorder && recorder.state === 'recording') stopRecord();
    else if (rec) setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, 350); // let the last word land
  }

  function openType() {
    box.classList.add('show');
    input.value = '';
    setTimeout(() => input.focus(), 0);
  }
  function closeType() { box.classList.remove('show'); input.blur(); }
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    closeType();
    deliver(text);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeType(); e.stopPropagation(); });
  input.addEventListener('blur', () => setTimeout(closeType, 100));

  ctx.on('key', (code, e) => {
    if (ctx.state === 'title' || ctx.state === 'compare') return;
    if (code === 'KeyV') start();
    if (code === 'KeyT' && ctx.state === 'play' && !ctx.hud.choosing) { e?.preventDefault(); openType(); }
  });
  ctx.on('keyup', (code) => { if (code === 'KeyV') stop(); });
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); start(); });
  mic.addEventListener('pointerup', stop);
  mic.addEventListener('pointerleave', stop);

  return { start, stop, openType, get listening() { return listening; }, get mode() { return mode; }, supported: !!SR || canRecord() };
}
