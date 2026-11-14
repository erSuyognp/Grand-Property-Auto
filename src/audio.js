// Engine note that rises with speed, tire squeal on drift, and a few UI blips. All Web Audio
// oscillators and noise: no audio files.
export function createAudio(ctx) {
  let ac = null, engine = null, engine2 = null, engineGain = null, squealGain = null, master = null, noiseBuf = null, tone = null;
  let muted = false, volume = 1, amb = null, music = null;

  function start() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5 * volume;
    master.connect(ac.destination);
    engine = ac.createOscillator(); engine.type = 'sawtooth';
    engine2 = ac.createOscillator(); engine2.type = 'square';
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 520;
    engineGain = ac.createGain(); engineGain.gain.value = 0;
    engine.connect(filter); engine2.connect(filter); filter.connect(engineGain); engineGain.connect(master);
    engine.start(); engine2.start();
    // squeal: band passed noise
    const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 7;
    squealGain = ac.createGain(); squealGain.gain.value = 0;
    noise.connect(bp); bp.connect(squealGain); squealGain.connect(master);
    noise.start();
  }
  const unlock = () => { start(); if (ac && ac.state === 'suspended') ac.resume(); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  function blip(freq = 660, dur = 0.12, type = 'sine', vol = 0.18) {
    if (!ac || muted) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ac.currentTime + dur);
  }

  // a footstep: a short thump of filtered noise, a little different every time
  function step(speed = 2.4) {
    if (!ac || muted || !noiseBuf) return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260 + Math.random() * 380; lp.Q.value = 1.2;
    const g = ac.createGain();
    const t = ac.currentTime, vol = 0.1 + Math.min(0.1, speed * 0.025);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.8, 0.16);
  }
  // the quiet hum of an empty house
  function roomTone(on) {
    if (!ac || !noiseBuf) return;
    if (on && !tone) {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
      const g = ac.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(0.05, ac.currentTime, 0.8);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start();
      tone = { src, g };
    } else if (!on && tone) {
      const old = tone; tone = null;
      old.g.gain.setTargetAtTime(0, ac.currentTime, 0.2);
      setTimeout(() => { try { old.src.stop(); } catch { /* already stopped */ } }, 900);
    }
  }

  // a soft rush of air: reveals and panels sliding in
  function whoosh(vol = 1) {
    if (!ac || muted || !noiseBuf) return;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    const g = ac.createGain(), t = ac.currentTime;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.3, 0.65);
  }
  const NOTES = [523.25, 659.25, 783.99, 1046.5];
  function star(i = 0) { blip(NOTES[Math.min(3, i + 1)], 0.35, 'triangle', 0.22); setTimeout(() => blip(NOTES[Math.min(3, i + 1)] * 2, 0.25, 'sine', 0.1), 60); }
  function fanfare() { NOTES.slice(0, 3).forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.16), i * 110)); }

  return {
    blip, step, roomTone, whoosh, star, fanfare,
    click() { blip(1100, 0.035, 'sine', 0.07); },
    chime() { blip(660, 0.14); setTimeout(() => blip(880, 0.2), 110); },
    thud() { blip(90, 0.18, 'triangle', 0.35); },
    setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.5 * volume; },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master && !muted) master.gain.setTargetAtTime(0.5 * volume, ac.currentTime, 0.05); },
    // a low city hum while outside: filtered noise that swells and fades slowly (self made)
    ambient(on) {
      if (!ac || !noiseBuf) return;
      if (on && !amb) {
        const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
        const g = ac.createGain(); g.gain.value = 0;
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = 0.07; lg.gain.value = 0.012;
        lfo.connect(lg); lg.connect(g.gain);
        g.gain.setTargetAtTime(0.03, ac.currentTime, 1.5);
        src.connect(lp); lp.connect(g); g.connect(master);
        src.start(); lfo.start();
        amb = { src, g, lfo };
      } else if (!on && amb) {
        const old = amb; amb = null;
        old.g.gain.setTargetAtTime(0, ac.currentTime, 0.4);
        setTimeout(() => { try { old.src.stop(); old.lfo.stop(); } catch { /* already stopped */ } }, 1500);
      }
    },
    // a soft four chord pad for the title and result screens (self made, generated here)
    music(on) {
      if (!ac) return;
      if (on && !music) {
        const g = ac.createGain(); g.gain.value = 0;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        lp.connect(g); g.connect(master);
        g.gain.setTargetAtTime(0.05, ac.currentTime, 1.2);
        const CH = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
        let i = 0;
        const play = () => {
          const t = ac.currentTime;
          for (const f of CH[i % CH.length]) for (const det of [-3, 3]) {
            const o = ac.createOscillator(), og = ac.createGain();
            o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
            og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.16, t + 0.7); og.gain.exponentialRampToValueAtTime(0.0001, t + 3.3);
            o.connect(og); og.connect(lp); o.start(t); o.stop(t + 3.4);
          }
          i++;
        };
        play();
        music = { g, timer: setInterval(play, 2800) };
      } else if (!on && music) {
        const old = music; music = null;
        clearInterval(old.timer);
        old.g.gain.setTargetAtTime(0, ac.currentTime, 0.5);
      }
    },
    toggleMute() { this.setMuted(!muted); return muted; },
    update(car, active) {
      if (!ac) return;
      this.ambient(active || ctx.state === 'inbox');
      this.music(ctx.state === 'title' || ctx.state === 'result');
      const sp = Math.abs(car.state.speed);
      const f = 48 + sp * 4.6;
      engine.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
      engine2.frequency.setTargetAtTime(f * 0.5, ac.currentTime, 0.05);
      engineGain.gain.setTargetAtTime(active ? 0.05 + Math.min(0.08, sp * 0.003) : 0, ac.currentTime, 0.08);
      squealGain.gain.setTargetAtTime(active ? car.state.drift * 0.16 : 0, ac.currentTime, 0.06);
    },
  };
}
