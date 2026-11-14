// Phone as the controller. The game opens a room on the websocket relay and shows a QR code
// linking to /phone?room=ID on the laptop's LAN address (same wifi or the laptop's hotspot;
// no tunnels). The phone sends steer / gas / brake / actions / speech; the game sends back
// the current card, saved homes and haptic cues.
import QRCode from 'qrcode';
import { cardData } from './format.js';

export function initController(ctx) {
  const room = ctx.params.get('room') || Math.random().toString(36).slice(2, 7).toUpperCase();
  let ws = null, connected = false, phones = 0, retry = 0;
  const box = document.createElement('div');
  box.id = 'qr';
  box.innerHTML = `<button class="tab"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg><span>Phone controller</span><i></i></button>
    <div class="inner"><canvas></canvas><div class="how"><b>Scan to drive with your phone</b><span class="url"></span><em>Same wifi or this laptop's hotspot. Accept the certificate warning once.</em></div></div>`;
  ctx.hud.root.append(box);
  const tab = box.querySelector('.tab'), canvas = box.querySelector('canvas'), urlEl = box.querySelector('.url'), dot = box.querySelector('i');
  tab.addEventListener('click', () => { tab.blur(); box.classList.toggle('open'); });

  function phoneUrl() {
    const c = ctx.config;
    const host = c.lanIp && c.lanIp !== '127.0.0.1' ? c.lanIp : location.hostname;
    if (c.httpsPort) return `https://${host}:${c.httpsPort}/phone?room=${room}`;
    return `${location.protocol}//${host}:${location.port}/phone?room=${room}`;
  }
  const url = phoneUrl();
  urlEl.textContent = url.replace(/^https?:\/\//, '');
  QRCode.toCanvas(canvas, url, { width: 148, margin: 1, color: { dark: '#14181f', light: '#fffaf0' } }).catch(() => {});
  window.__gpa.room = room;
  window.__gpa.phoneUrl = url;

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function state() {
    const near = ctx.listingsSys.near;
    const tour = ctx.tour.active ? ctx.tour.info() : null;
    return {
      t: 'state', mode: ctx.state, city: ctx.world?.area?.name || '',
      card: near ? { ...cardData(near), saved: ctx.saved.has(near.id) } : null,
      tour, saved: ctx.saved.list().map((l) => ({ ...cardData(l) })).sort((a, b) => 0),
      mission: ctx.missions.active ? { target: ctx.missions.target?.name || ctx.missions.target?.address } : null,
      choosing: ctx.hud.choosing,
    };
  }
  let lastState = '';
  function pushState(force) {
    if (!phones) return;
    const s = JSON.stringify(state());
    if (s !== lastState || force) { lastState = s; send(JSON.parse(s)); }
  }

  function onMessage(m) {
    const p = ctx.input.phone;
    if (m.t === 'peer') {
      if (m.role === 'phone') {
        phones = Math.max(0, phones + (m.on ? 1 : -1));
        box.classList.toggle('linked', phones > 0);
        dot.title = phones ? 'Phone connected' : '';
        if (m.on) { ctx.hud.toast('Phone connected'); ctx.audio.chime(); box.classList.remove('open'); pushState(true); ctx.emit('phone', true); }
        else { p.active = false; ctx.emit('phone', false); }
      }
      return;
    }
    if (m.t === 'drive') {
      p.active = true; p.last = performance.now();
      p.steer = Math.max(-1, Math.min(1, Number(m.steer) || 0));
      p.gas = Math.max(0, Math.min(1, Number(m.gas) || 0));
      p.brake = Math.max(0, Math.min(1, Number(m.brake) || 0));
      if (ctx.tour.active && Math.abs(p.steer) > 0.25) ctx.tour.look((ctx.tour.path === 'W' ? -1 : 1) * p.steer * 0.03);
      // walking a home from the phone: tilt turns, the pedals walk forward and back
      if (ctx.tour.active) ctx.tour.pad(0, p.gas - p.brake);
    } else if (m.t === 'key' && typeof m.code === 'string' && /^(Key[A-Z]|Digit\d|Escape|Enter|Tab|Arrow(Up|Down|Left|Right))$/.test(m.code)) {
      ctx.emit('key', m.code, null);
      setTimeout(() => ctx.emit('keyup', m.code, null), 60);
    } else if (m.t === 'say' && typeof m.text === 'string') {
      if (ctx.maya) ctx.maya.hear(m.text.slice(0, 200)); else ctx.missions.handle(m.text.slice(0, 200));
    } else if (m.t === 'live') {
      ctx.hud.live(m.text == null ? null : String(m.text).slice(0, 200));
    } else if (m.t === 'tour') {
      if (m.act === 'forward') ctx.tour.forward();
      else if (m.act === 'back') ctx.tour.stepSweep(-1);
      else if (m.act === 'look') ctx.tour.look(Number(m.dx) || 0, Number(m.dy) || 0);
      else if (m.act === 'empty') ctx.tour.toggleEmpty();
      else if (m.act === 'exit') ctx.tour.exit();
    } else if (m.t === 'unsave' && m.id) {
      const l = ctx.saved.list().find((x) => x.id === m.id);
      if (l) ctx.saved.remove(l);
    } else if (m.t === 'hello') pushState(true);
  }

  function connect() {
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${room}&role=game`);
    } catch { return; }
    ws.onopen = () => { connected = true; retry = 0; };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore bad frames */ } };
    ws.onclose = () => { connected = false; phones = 0; box.classList.remove('linked'); ctx.input.phone.active = false; if (retry++ < 30) setTimeout(connect, 2000 + retry * 500); };
    ws.onerror = () => {};
  }
  connect();

  let acc = 0;
  ctx.on('update', (dt) => { acc += dt; if (acc > 0.25) { acc = 0; pushState(); } });
  for (const ev of ['near-listing', 'saved', 'tour-state', 'mission']) ctx.on(ev, () => setTimeout(pushState, 0));
  ctx.on('collision', (v) => { if (v > 5) send({ t: 'buzz', ms: Math.min(160, 30 + v * 6) }); });
  ctx.on('arrived', () => send({ t: 'buzz', ms: [60, 60, 120] }));
  ctx.on('spoken', (text) => send({ t: 'caption', text }));

  return { room, url, send, get phones() { return phones; }, get connected() { return connected; }, el: box };
}
