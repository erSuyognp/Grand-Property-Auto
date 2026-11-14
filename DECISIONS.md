# Decisions

## Phase 0
- Vite dev server on 5173, Node server on 8787; Vite proxies `/api` and `/ws` so the browser only talks to one origin.
- `npm run shot` starts its own Vite + server via Playwright `webServer`, so it works without `npm run dev` running.
- Game exposes `window.__gpa` (ready flag, fps, mode, car position) for Playwright to read; it is harmless in production.
- Phase 0 placeholder scene: flat ground and a box car so the shot script has something to drive. Phase 3/4 replace it.
- Prompt 0 was revised after the first scaffold commit (data agreement rules). Re-ran it as a second "phase 0" commit: CLAUDE.md now carries the seven rules verbatim, LICENSES.md, purge.sh, data window guard, mock mode.
- Mock mode: server `GAME_MODE` is exposed via `/api/config`; `?mode=mock` in the URL overrides it. `src/data.js` maps every city to `/data/mock/` in mock mode and falls back to mock when a real file is missing or the server is down. `/api/config` never returns the SDK key in mock mode.
- `tools/make_mock_data.py` is written in Phase 1 (its prompt owns it); Phase 0 only creates `public/data/mock/`.
- Data window guard: `server/dataWindow.js` (Express middleware on `/api/vexcel` and `/api/matterport`, plus `assertDataWindow()` for direct calls) and `tools/data_window.py` for Python tools. Window is fixed to EST (UTC-5), since Nov 13-15 is after the DST change.
- `.gitignore` ignores all of `data/` and all of `public/data/` except `public/data/mock/`; the old `public/data/la|houston/.gitkeep` files were untracked.
- The CoStar kit is at `data/raw/costar-hackathon-kit/`, not `data/raw/costar/` as BUILD_PLAN.md says. Phase 1 should read it from there.
- Licenses: two transitive packages are outside the MIT/BSD/Apache/ISC list. fast-sha256 (Unlicense, public domain, via @anthropic-ai/sdk) and lightningcss (MPL-2.0, Vite build-time only, not bundled, not modified). Neither is GPL/LGPL/AGPL; kept. Flag to CoStar if they want strict compliance.
- `.env` does not exist yet: all keys are missing, so later phases run on mock data until it is filled in.

## Needs real data
- `.env` with VEXCEL_API_KEY, MATTERPORT_API_KEY / _API_TOKEN / _SDK_KEY, ANTHROPIC_API_KEY (none present at Phase 0).
