// Data agreement rule 1: Sponsor Data APIs (Vexcel, Matterport) may only be called between
// Fri Nov 13 2026 4:30 PM and Sun Nov 15 2026 4:00 PM America/New_York (EST, UTC-5).
export const WINDOW_START = new Date('2026-11-13T16:30:00-05:00');
export const WINDOW_END = new Date('2026-11-15T16:00:00-05:00');

export function inDataWindow(now = new Date()) {
  return now >= WINDOW_START && now < WINDOW_END;
}

// Throws (and logs why) when outside the window. Call before every Vexcel or Matterport request.
export function assertDataWindow(what, now = new Date()) {
  if (inDataWindow(now)) return;
  const msg = `[data-window] refused ${what}: ${now.toISOString()} is outside ` +
    `${WINDOW_START.toISOString()} .. ${WINDOW_END.toISOString()} (Nov 13 4:30 PM to Nov 15 4:00 PM ET)`;
  console.warn(msg);
  const err = new Error(msg);
  err.status = 403;
  throw err;
}

// Express middleware for /api/vexcel/* and /api/matterport/*.
export function dataWindowGuard(what) {
  return (req, res, next) => {
    try {
      assertDataWindow(`${what} ${req.method} ${req.path}`);
      next();
    } catch (e) {
      res.status(403).json({ error: 'outside data window', detail: e.message });
    }
  };
}
