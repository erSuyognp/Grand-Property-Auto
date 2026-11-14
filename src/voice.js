// Hold V (or the mic button, or the phone's mic) to talk. Live captions show at the bottom
// center while talking. T opens a one line type box as the fallback.
export function initVoice(ctx) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, finalText = '', interim = '', wantStop = false;
  const box = ctx.hud.el.typebox, input = box.querySelector('input');

  const mic = document.createElement('button');
  mic.id = 'micbtn';
  mic.title = 'Hold to talk (V)';
  mic.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Hold <kbd>V</kbd> to talk</span>';
  ctx.hud.root.append(mic);

  function start() {
    if (listening) return;
    if (!SR) { openType(); return; }
    finalText = ''; interim = ''; wantStop = false;
    try {
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
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
          ctx.hud.toast(e.error === 'network' ? 'Speech needs internet. Press T to type' : 'Mic blocked. Press T to type');
        }
      };
      rec.onend = () => {
        const text = (finalText + interim).trim();
        listening = false;
        mic.classList.remove('on');
        ctx.hud.live(null);
        if (text) ctx.missions.handle(text);
      };
      rec.start();
      listening = true;
      mic.classList.add('on');
      ctx.hud.live('');
      ctx.audio.blip(740, 0.07);
    } catch {
      listening = false;
      openType();
    }
  }
  function stop() {
    if (!listening || wantStop) return;
    wantStop = true;
    setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, 350); // let the last word land
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
    if (text) ctx.missions.handle(text);
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

  return { start, stop, openType, get listening() { return listening; }, supported: !!SR };
}
