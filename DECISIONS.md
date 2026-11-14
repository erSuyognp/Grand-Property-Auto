# Decisions

## Phase 0
- Vite dev server on 5173, Node server on 8787; Vite proxies `/api` and `/ws` so the browser only talks to one origin.
- `npm run shot` starts its own Vite + server via Playwright `webServer`, so it works without `npm run dev` running.
- Game exposes `window.__gpa` (ready flag, fps, car position) for Playwright to read; it is harmless in production.
- Phase 0 placeholder scene: flat ground and a box car so the shot script has something to drive. Phase 3/4 replace it.

## Needs real data
- (none yet; checked in Phase 1)
