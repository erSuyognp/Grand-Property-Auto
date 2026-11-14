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

## Phase 1
- **Rule 7 conflict, left for the owner.** BUILD_PLAN.md Part 0 was revised to say CoStar confirmed in Discord that third party APIs are OK and `LLM_ENABLED=true` by default. CLAUDE.md rule 7 (which overrides the plan) still has the old text, and `.env` / `.env.example` still say `LLM_ENABLED=false`. I did not edit CLAUDE.md's rules or the defaults. The LLM path is built and works when `LLM_ENABLED=true`; flipping it is a one line change for the owner (see MORNING.md).
- The kit is now at `data/raw/costar/` (the Phase 0 note about `costar-hackathon-kit/` is out of date).
- **Area pick.** `tools/pick_area.py` slides a 1.5 km box over each city. Apartment communities are capped at 10 per box in the score, because with the plain weights LA picked a Koreatown box with 66 apartment towers and one home, which is a poor fit for a home buyer game. Result: Houston = Rice Military / Washington Ave (8 current homes, 15 sold, 10 apartment communities), LA = Downtown / South Park (6 current, 2 sold, 34 apartment communities).
- **Houston is the hero city** for the demo (more homes for sale); LA is the second city.
- **Building heights come from DSM minus DTM.** `include=calculated` returned implausible heights and the precomputed height fields were null, so the plan's step (a) is skipped. DTM is ground, DSM is surface (the docs are not swapped).
- **Matterport API**: production Model API with basic auth (key = user, token = password), as in the quickstart. `MATTERPORT_GRAPHQL_URL` in `.env` is unused.
- **Showcase base URL: `https://my.matterport.com`** connects with the Embed SDK on localhost (checked with Playwright, 61 sweeps). `beta-app.matterport.com` does not connect. Path A is the main tour path.
- Skybox links are signed and expire within hours, so Phase 2 downloads the faces it needs.
- Extra files in the game data format: `scatter.json` (tree and pool positions) and `area.json` (center, bbox, flat flag), so the client never has to guess them.
- Mock data: 1,389 invented buildings, 80 invented listings, 4 procedural interiors (with an "empty" variant for "See it empty"). 4.8 MB, committed.
- **Schema-bearing code is local only (rule 3).** Scripts that embed Sponsor field paths, endpoint paths or query shapes live in `tools/sponsor/` (and later `server/sponsor/`), which are gitignored and deleted by `tools/purge.sh`. `tools/pick_area.py` and `tools/build_city.py` are thin tracked wrappers. API hostnames come from env vars. Downside: those scripts are not in git history; they exist only on this laptop.
- `data/raw/terms.txt` is not present; the rules in CLAUDE.md were followed instead.

## Needs real data
- (Resolved in Phase 1: `.env` now has every key.)
