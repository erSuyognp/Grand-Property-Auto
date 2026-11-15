// A burst of paper for a three star result. One canvas, drawn for about two and a half
// seconds, then removed. Nothing is shown when reduced motion is on.
const COLORS = ['#ffc940', '#ff5a2c', '#2fd46b', '#3aa0ff', '#b46bff', '#fffaf0'];

export function confetti(ctx, { count = 150, x = 0.5, y = 0.42 } = {}) {
  const reduced = ctx.settings?.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || document.getElementById('confetti')) return;
  const cv = document.createElement('canvas');
  cv.id = 'confetti';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.append(cv);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const parts = Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.5, sp = 380 + Math.random() * 620;
    return {
      x: W * x + (Math.random() - 0.5) * 120, y: H * y + (Math.random() - 0.5) * 30,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
      w: 6 + Math.random() * 7, h: 9 + Math.random() * 9, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
      tilt: Math.random() * 6.28, vt: 5 + Math.random() * 9, color: COLORS[i % COLORS.length], round: i % 5 === 0,
    };
  });
  const LIFE = 2.6;
  let last = performance.now(), t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    g.clearRect(0, 0, W, H);
    const fade = Math.max(0, Math.min(1, (LIFE - t) / 0.7));
    for (const p of parts) {
      p.vy += 1150 * dt;                       // gravity
      p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 0.6 * dt; // air
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.tilt += p.vt * dt;
      g.save();
      g.globalAlpha = fade;
      g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.tilt)); // the flip of a falling piece of paper
      g.fillStyle = p.color;
      if (p.round) { g.beginPath(); g.arc(0, 0, p.w * 0.5, 0, 6.28); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (t < LIFE && cv.isConnected) requestAnimationFrame(frame); else cv.remove();
  }
  requestAnimationFrame(frame);
}
