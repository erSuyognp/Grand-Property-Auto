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

## Realism pass and walkable interiors (Nov 14, asked for in chat)
- "Like GTA 5" was read as a realistic open world look, not a copy of that game: all art is still original (CLAUDE.md rule) and nothing is taken from it. A browser game built from one aerial photo cannot match a AAA title; this pass closes what it can.
- Lighting: physically based sky with clouds, sun shadows, reflections from the sky on glass and paint, filmic tone mapping, bloom, vignette, grain, speed blur. `L` cycles midday, golden hour and night (lit windows, street lamps, headlights). `?time=night` sets it from the URL.
- Sky reflections are kept weak on matte surfaces on purpose: at full strength the blue sky turned every shadow bright blue.
- Screen space ambient occlusion was left out: it renders the scene twice and puts halos on the listing markers; shadows plus the baked aerial shading carry it.
- Buildings: houses get sloped roofs with eaves built from the footprint (the aerial photo stays on the roof); other buildings get parapets. Five facade materials with glass that mirrors the sky. Roof shapes are approximations, not the real ridge lines.
- Streets (`src/roads.js`): there is still no road data, so streets are traced from the aerial photo when a city loads (about half a second). The grid angle comes from the building walls; the photo is turned to it and every row and column is searched for runs of asphalt colored pixels at least 110 m long that no building interrupts. Side by side runs form one street with a center line and a width. Houston: 184 segments, LA: 156 (grid at 38 degrees), mock: 58.
- The streets are baked into a distance map and drawn by the ground shader: clean asphalt (the cars and shadows baked into the photo disappear from the roadway), a gutter, a kerb, a sidewalk with paving joints, and paint by width (double yellow on wide streets, a dashed yellow line on medium ones, dashed white lane lines on the widest, none on narrow ones). Paint stops at junctions. No crosswalks or stop lines.
- Kerbs are drawn, not raised: the ground is still one flat surface, so the car does not bump over them.
- Only straight streets on the grid are found. Curved roads, freeway ramps and anything shorter than 110 m keep the photo, and a long straight parking aisle can be mistaken for a street. Building to building strips wider than 21 m are treated as roadway plus sidewalks.
- Routes, the spawn point, street lamps and traffic now use the traced streets instead of "anything gray". Traffic keeps to the right of the route. `?noroads` turns the tracing off.
- Off the streets, near the camera, the shader still reads the photo (dark gray = asphalt, green = planting) and lays a sharp material over it.
- Trees are leaf cards with dappled shadows; street lamps stand where road meets non road; 9 ambient cars drive the same routes the gold line uses. No pedestrians (no character art to make them from).
- Walk inside is now free walking (WASD) by default. The scan API offers a 50k triangle mesh per home (geometry only, no textures), so the game projects the panorama photos onto it from the two nearest scan points, with a visibility test so photos do not land on surfaces that scan point could not see. Close to a scan point it matches the photo tour; between points, surfaces neither point saw are smeared. `T` still switches to the Matterport Showcase and to the photo spots.
- Walk mode data: `python tools/build_mesh.py --city <city>` (local only script in `tools/sponsor/`). 16 panoramas per home instead of 8. Houston 40 of 47 scans and LA 49 of 65 have a mesh; the rest fall back to the Showcase or photo spots. Mock mode has no meshes and keeps the photo spots.
- New dependency: `three-mesh-bvh` (MIT), logged in LICENSES.md.
- Pixel ratio cap went from 1.75 to 1.5 to pay for the HDR pipeline; adaptive quality now drops resolution, then shadows, then bloom.

## Real 3D city and drone view (Nov 14, asked for in chat)
- `src/tiles.js` shows Google Photorealistic 3D Tiles in place of the block city (NASA 3DTilesRendererJS with the Google auth, reorientation, fade and compression plugins, Draco and KTX2 loaders served from our own origin). `G` switches between the two; the choice is remembered.
- **Not seen working yet.** On Nov 14 Google answered every tile request for the key in `.env` with HTTP 403 (first "Map Tiles API has not been used in project ... or it is disabled", later "Permission denied on the service"). The automatic fallback to the block city was seen working; alignment, brightness, ground following and frame rate with real tiles were not. See MORNING.md for the one switch to flip.
- The Google key goes to the browser through `/api/config` (never in mock mode), not through the bundle, so the bundle check did not need loosening; its comment and the config test now list the key as allowed.
- What Google receives: tile requests for the area around the camera, from the browser. No listing, address, price or any CoStar, Vexcel or Matterport data is sent. Mock mode never loads tiles (its neighborhood is not a real place), and the tiles need internet, so offline the block city is used.
- The plugin leaves west on +x and north on +z; the tiles sit in a holder turned half a turn so east is +x and south is +z like `src/geo.js`. The area's ellipsoid height is not known, so instead of lifting every marker, the tiles are moved up or down until their street matches our terrain where the car stands (measured twice: long rays first, short rays once sharper tiles arrive).
- Ground under the car: rays cast down from just above our terrain height (so tree canopies and roofs are not hit), lowest of five nearby rays (so a parked car in the photo mesh is not a bump), cached per 1.5 m cell for 7 seconds, at most 8 new cells per frame, terrain.json where a ray misses or disagrees by more than 4 m.
- Tiles are unlit and take no shadows; their brightness follows the time of day. The car keeps its sun shadow through a small shadow catcher under it.
- Frame rate: errorTarget starts at 16, rises by 4 when under 50 fps and creeps back when there is room.
- Tests run with `tiles=0` so they do not depend on Google or spend quota; `SHOT_TILES=1 npm run shot` shoots the 3D city.
- Drone view (`src/drone.js`, key `Q`): only two Houston homes for sale in our areas have an exterior splat, none in LA. `python tools/build_splat.py --city houston` downloads each splat (about 160 MB), keeps the 700,000 Gaussians that matter most within 38 m of the house and writes a 22 MB `.splat`. The orbit runs at about 41 to 45 fps on this laptop; fewer Gaussians would raise that.
- The splat's own frame is not aligned to north, so the orbit starts at a random bearing; it is not lined up with the street outside.

## Walk mode (Nov 14, asked for in chat)
- **The MatterPak textured mesh could not be used.** For all 116 scans we have (47 Houston, 69 LA) the API reports the MatterPak bundle as unlocked but every file in it as `unavailable` with no download link: the zips were never generated. Generating them is a request against CoStar's Matterport account (the kit says to ask in the track channel), so it was not done. The downloader and converter are written (`tools/sponsor/build_matterpak.py`: MatterPak zip read by byte ranges, textures capped at 2048 px, `obj2gltf` then `gltf-pipeline` with Draco) but have never run on a real file, and the game does not load a GLB yet.
- What walk mode uses instead: the 50k triangle geometry mesh from `build_mesh.py` (no texture coordinates) with a **base color baked per vertex from the panoramas** (`tools/build_walk.py`): each vertex takes what the two nearest scan points that face it see there. It is soft (a vertex every 15 to 20 cm) but it is the home's own color, and it fills what the photos cannot.
- Frame check: for the 8 demo homes, six scan points each sit 1.3 to 1.5 m above the mesh floor straight below them (one outlier at 1.86 m), so mesh and scan positions share one frame.
- The 8 demo homes are Houston listings ranked by distance to the area center minus 4 m per scan, homes before apartment communities. They got 2K sky boxes; the first two also 4K.
- Shader: base color, then the photo of the two nearest scan points through a distance cube map rendered from each scan point (no painting through walls), blended by distance. "Fade to the base texture beyond about 4 m from any scan" is read as the **player's** distance to the scan (fades between 4 and 6.2 m), because a wall 5 m from the scan still looks far better as a photo than as vertex color; surfaces more than 11 to 16 m from the scan, or hidden from it, also fall back to the base color.
- Sky boxes load at 1K at once, then the sharpest tier allowed for the scan you stand at. On integrated GPUs (this laptop) that is 2K: a 4K panorama is about 400 MB of texture. 4K is used on a discrete GPU or with `?walk4k`, and is untested.
- Movement: 1.6 m eye height, 0.3 m radius, nine rays per step (shin, hip and head height; ahead and 40 degrees to each side), slide along what is hit, steps up to 0.35 m, gravity past that, acceleration 14 m/s2, 2.4 m/s walk and 4.3 m/s with Shift, 2.6 cm head bob. Click to lock the mouse; Esc frees it, Esc again exits. Phone: tilt turns, the pedals walk.
- "See it empty" in walk mode switches to the photo view (the furniture free panoramas are not projected), and the button says so.
- Open doorways are real holes in the scan mesh even where a panorama shows the door closed, so you can walk through a door that looks shut. Gaps in the scan show the home's average wall color.
- Mock mode still has no meshes and uses the photo spots. Homes without a mesh (7 Houston, 16 LA scans) use the Showcase or photo spots as before.

## Needs real data
- (Resolved in Phase 1: `.env` now has every key.)
- MatterPak textured meshes: unlocked but not generated for any of our scans. Ask CoStar or Matterport (track channel) to generate MatterPaks for the 8 demo homes, then run `python tools/sponsor/build_matterpak.py --city houston`; the game still needs a GLB loader for the result.
- Google 3D city: the key in `.env` is refused (HTTP 403). Enable the Map Tiles API and billing on the key's Google Cloud project, and allow the key to call it.
- Listing photos: the photo hosts refuse scripted downloads (403). If CoStar can provide a way to fetch them, rerun `python tools/build_city.py --city houston --steps listings,photos`.
