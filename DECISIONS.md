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
- **Building heights come from surface height minus ground height.** The per-parcel height option returned implausible values and the stored height fields were empty, so the plan's step (a) is skipped. The two elevation services are not swapped in the docs. Details: `data/VEXCEL_NOTES.md` (local only).
- **Matterport API**: endpoint and auth exactly as in the quickstart script; `MATTERPORT_GRAPHQL_URL` in `.env` is unused. Details: `data/MATTERPORT_NOTES.md` (local only).
- **Showcase base URL: `https://my.matterport.com`** connects with the Embed SDK on localhost (checked with Playwright, 61 sweeps). The hackathon site's own host does not connect. Path A is the main tour path.
- Skybox links are signed and expire within hours, so Phase 2 downloads the faces it needs.
- Extra files in the game data format: `scatter.json` (tree and pool positions) and `area.json` (center, bbox, flat flag), so the client never has to guess them.
- Mock data: 1,389 invented buildings, 80 invented listings, 4 procedural interiors (with an "empty" variant for "See it empty"). 4.8 MB, committed.
- **Schema-bearing code is local only (rule 3).** Scripts that embed Sponsor field paths, endpoint paths or query shapes live in `tools/sponsor/` (and later `server/sponsor/`), which are gitignored and deleted by `tools/purge.sh`. `tools/pick_area.py` and `tools/build_city.py` are thin tracked wrappers. API hostnames come from env vars. Downside: those scripts are not in git history; they exist only on this laptop.
- `data/raw/terms.txt` is not present; the rules in CLAUDE.md were followed instead.

## Phase 2
- **Duplicate building outlines.** The parcel data returned each structure many times (16,803 outlines for about 1,700 real buildings in Houston, because overlapping parcels each carry the structure). The pipeline now keeps the largest outline of each overlapping group before asking for heights. That also cut the slow surface height calls by 10x.
- **Heights:** surface minus ground at one or two roof points per building, clamped to 260 m (not 60 m as planned, so downtown LA keeps its towers). Anything under 2.5 m falls back to 7 m (small) or 12 m (large). The surface height lookup is slow (about 25 s per batch); the first Houston run took 37 minutes for that reason.
- **Ground image:** fetched at the finest zoom as a 2 x 2 split, stitched on the Web Mercator pixel grid, saved at 8192 px (14 MB) plus a 4096 px copy for weak GPUs. Bounds come from the image metadata. Footprints sit on the roofs (data/samples/align_houston.jpg).
- **Houston terrain is not flat** inside the box (22 m range, the bayou), so the ground mesh follows the terrain.
- **Listing photos could not be cached.** Both photo hosts answer 403 to scripted downloads (with or without a browser user agent). I did not try to get around that. Cards and the saved homes screen use, in order: the listing photo if the browser can load it (probed once per city), a still from the home's own 3D scan, then the angled aerial photos. So every card has a real picture with no internet.
- **Matterport downloads:** the first model of each listing, plus the first model of up to two floor plans per apartment community; 8 scan positions per model picked as a walkable spread, faces at 1024 px, with the furniture free view where it exists. About 12 MB per model, loaded only when you walk in. The Showcase path still reaches every scan position of every model.
- Listings whose point is not inside a footprint take the nearest building (all Houston listings matched within 30 m).
- Curb photos use the building outline plus an 8 m buffer; all four directions where they exist.
- "Nearby" keeps the 15 strongest tiles per word; a listing's distance is to the nearest of those.
- Commercial scenery is thin in Houston (1 property that is not an apartment community).
- **Build output holds no Sponsor Data.** Vite no longer copies `public/` wholesale: only `public/data/mock/` goes into `dist/`. The local server serves real city files straight from `public/data/`. `npm run build` fails if a server key or a real city folder shows up in `dist/`.

## Phases 3 to 9 (built together while the Houston pipeline ran)
- The seven game phases were written against the mock neighborhood during the 37 minute height download, then checked on real Houston data. They are committed together because the systems import each other; each phase's "done when" check is a Playwright test (tests/shot.spec.js, tests/smoke.spec.js, tests/tour.spec.js).
- **World:** roofs are textured from the aerial image; walls get a small procedural window texture (houses) or a glass grid (anything over 13 m). Listing buildings glow slightly. Shadows follow the car. Quality drops automatically (shadows off, then resolution) when the frame rate stays under 40.
- **No road data:** the route finder runs A* on a 4 m grid from the footprints and makes gray, road-like pixels of the aerial image cheap. The gold line follows streets most of the time and cuts across lots when that is much shorter.
- **Spawn** is the road-like spot nearest the center, facing down the longest clear stretch.
- **Camera** lifts over a roof instead of sitting inside a building.
- **Listing proximity** is measured to the building outline (25 m), not the listing point, so large apartment buildings trigger their card from the street.
- **Tours:** Path A is the Showcase with the Embed SDK; it falls back to Path B after 8 s. "See it empty" always uses Path B, because the furniture free panoramas are ours to show. T switches paths. G toggles empty, N next space, W next spot.
- **Path B orientation was calibrated against the Showcase** (tests/calibrate.spec.js, four scan positions): undo the pano's rotation, then view = (-y, z, -x). The floor rings point at the real positions of the other scans.
- **Voice:** hold V (browser speech recognition), T to type. The keyword parser is shared by the browser and the server and handles every line in DEMO_SCRIPT.md offline. It also understands commands: "take me inside", "save this one", "see it empty", "show me everything".
- **LLM:** `claude-sonnet-5-5` by default (`ANTHROPIC_MODEL` to change), thinking off between tools and low effort for speed; measured 1.6 to 2.4 s per mission and 1.6 s per narration. 3 s budget, one retry inside the budget, then the keyword parser. The model gets the spoken words, the current filters and five numbers of the last home; narration gets numbers, highlights and aerial flags. No addresses, ids or agent data.
- **Narrator voice:** the browser voice, preferring on-device voices (remote browser voices send the text to a third party). `TTS_API_KEY` looks like an ElevenLabs key and is used only when `LLM_ENABLED=true`, since it is the same kind of third party sharing.
- **Pool filter** means a pool seen from the air; the narration and the card say so when the listing itself does not mention one.
- **Phone controller:** the phone page needs a secure page for tilt and the mic, so the server also listens on https port 8443 with a self-signed certificate made at startup (the phone shows a one-time warning). The QR code points at the laptop's LAN address. There is a drag bar and a type box for phones that block tilt or speech. No tunnels.
- **Title screen** starts the game on Enter or when a phone connects. `?autostart=1` skips it (tests use this).
- **Demo mode (0):** autopilot follows the route with a simple pursuit controller; if it gets stuck it backs up, then hops back onto the line, so the video never stalls.
- Offline: with the server stopped the game loads from the build, uses the local parser and template narration, the built in viewer for tours, and hides nothing behind a network call.

## Phase 10
- `npm run demo` is the one command: build, bundle secret check, then the Node server serves `dist/` on http://localhost:8787 (and real city files from `public/data/`).
- `tools/check_bundle.mjs` fails the build if any server key or a real city folder is in `dist/`. The Matterport SDK key is not in the bundle either; the page reads it from `/api/config`.
- `tools/check_confidential.py` scans every tracked file for real listing ids, addresses, community names, model ids, `.env` secrets and sponsor API hostnames, and checks that no remote is configured. It passes. `BUILD_PLAN.md` (the owner's plan, which quotes event materials) is reported as a warning and left untouched.
- README and Devpost images come from `docs/mock_shots/` (mock mode, QR panel hidden so the laptop's network address is not shown).
- Optional settings were added to `.env.example` (model name, SDK script URL, API base, ports). `LLM_ENABLED` there is unchanged (see Phase 1).

## Needs real data
- (Resolved in Phase 1: `.env` now has every key.)
- Listing photos: the photo hosts refuse scripted downloads (403). If CoStar can provide a way to fetch them, rerun `python tools/build_city.py --city houston --steps listings,photos`.
