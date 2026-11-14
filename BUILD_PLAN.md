# Grand Property Auto: Overnight Build Plan for Claude Code

**Grand Property Auto** is a GTA style browser game for home buyers. You drive a real LA or Houston neighborhood built from Vexcel aerial data, pull up to homes for sale or rent from the CoStar data kit, and walk inside the real Matterport scan. Free roam by default, with voice missions ("three beds under $900k with a pool") that light up matches and guide you there.

Built for the HackPrinceton Fall 2026 CoStar track ("Inside and Out: AI for the Built World"). The judges' theme: AI is an input, not a chat window. Voice first, phone as a controller, and an experience that follows a nonlinear conversation instead of a search funnel.

---

## Part 1: What to collect before you sleep

Put every key in `.env` (never commit it). Put every file under `data/raw/`.

### Required

| # | What | Where to get it | What Claude Code needs from it |
|---|------|-----------------|--------------------------------|
| 1 | **Vexcel API key** | The CoStar bot in Discord (`/ask-costar`), or the CoStar table | `VEXCEL_API_KEY` |
| 2 | **Vexcel tutorial + Python script** | Steve Lombardi said there is a hackathon tutorial and script. Ask the bot or the table | Save to `data/raw/vexcel/`. It tells Claude Code the exact Elevation endpoint, layer names and rate limits, which the slides don't show |
| 3 | **Matterport API credentials** | Quickstart: `beta-app.matterport.com/2026-princeton-hackathon/quickstart` | `MATTERPORT_TOKEN_ID`, `MATTERPORT_TOKEN_SECRET` (or whatever the quickstart issues) |
| 4 | **Matterport Showcase SDK key** | Same quickstart page | `MATTERPORT_SDK_KEY`. Needed to embed tours in an iframe and control them |
| 5 | **Matterport Showcase URL format** | Quickstart page. Check whether tours open at `my.matterport.com/show/?m=ID` or a `beta-app.matterport.com` URL | `MATTERPORT_SHOWCASE_BASE` |
| 6 | **CoStar data kit** | The bot gives each team access | All eight datasets (JSON) plus **both starter CSVs** (property to Matterport and home to Matterport) plus the schema docs. Save to `data/raw/costar/` |
| 7 | **LLM API key** | Anthropic console (or a sponsor credit if HackPrinceton gives one) | `ANTHROPIC_API_KEY`. Used only to turn speech into filters and write short arrival narration |

### Optional (the build works without these)

| What | Why | Key |
|------|-----|-----|
| ngrok or Cloudflare Tunnel account | Lets a phone on cellular reach your laptop for the phone controller. On the same wifi you don't need it | `NGROK_AUTHTOKEN` |
| Vercel or Cloudflare Pages account | Public link for judges. Phone controller websockets need a real server, so the tunnel is simpler for the live demo | none in `.env` |
| ElevenLabs or OpenAI TTS key | Nicer narrator voice. The browser's built in speech works as a free fallback | `TTS_API_KEY` |

### Not needed
Google Maps, Mapbox, Cesium Ion, Zillow. Everything visual comes from Vexcel and Matterport, which is what the sponsor wants to see.

### Questions to ask the CoStar or Vexcel people tonight (paste answers into `data/raw/NOTES.md`)
1. What is the Elevation (DSM and DTM) endpoint, and what format does it return?
2. Does `property/extract` accept a POLYGON for an area, or only a POINT? Is there a max area or record count?
3. Do Elements building records include a height attribute?
4. Rate limits per key?
5. Is there a cap on Matterport API calls or embeds?

### `.env.example`
```
VEXCEL_API_KEY=
MATTERPORT_TOKEN_ID=
MATTERPORT_TOKEN_SECRET=
MATTERPORT_SDK_KEY=
MATTERPORT_SHOWCASE_BASE=https://my.matterport.com/show/
ANTHROPIC_API_KEY=
NGROK_AUTHTOKEN=
TTS_API_KEY=
```

---

## Part 2: How to run it overnight

1. Make an empty folder, `git init`, copy this file in as `BUILD_PLAN.md`, add `.env` and `data/raw/`.
2. Paste **Prompt 0** into Claude Code. It creates `CLAUDE.md` and the project skeleton.
3. Paste the **Master prompt**. It works through Phases 1 to 10 in order, checking off boxes in `BUILD_PLAN.md`, and committing after each phase.
4. If a session ends before everything is checked off, start a new one with: `Continue the Master prompt from the first unchecked phase in BUILD_PLAN.md.`

For truly hands off running, you can loop it in headless mode in a terminal:
```bash
until grep -q "ALL PHASES DONE" PROGRESS.md 2>/dev/null; do
  claude -p "Continue the Master prompt from the first unchecked phase in BUILD_PLAN.md. Do not ask questions." \
    --dangerously-skip-permissions --max-turns 200
done
```
Only use `--dangerously-skip-permissions` inside a folder that holds nothing but this project, and with `.env` gitignored. The safer alternative is to allowlist `npm`, `node`, `python`, `git`, `npx playwright` and `curl` in `.claude/settings.json`.

---

## Part 3: The prompts

### Prompt 0: Setup (paste first)

```
Read BUILD_PLAN.md fully. Then set up the project:

1. Create CLAUDE.md with:
   - One paragraph on what Grand Property Auto is (copy from BUILD_PLAN.md top).
   - Rules: never ask me questions, make the reasonable call and log it in DECISIONS.md.
     Never commit .env or data/raw. Commit after every phase with message "phase N: ...".
     Every phase must keep the game runnable. If real data or a key is missing, use the
     mock data path and keep going; never block.
     After each phase run `npm run build` and `npm run shot` and look at the screenshots
     before checking the phase off.
   - The folder layout below.
2. Scaffold a Vite + vanilla JS + Three.js app (no React). Folders:
     src/            game code (one module per system: world, car, camera, listings, hud,
                     minimap, tour, missions, voice, controller, audio)
     server/         small Node (Express + ws) server: /api/mission, /api/narrate,
                     /api/vexcel/* proxy, websocket relay for the phone controller
     tools/          Python data scripts
     data/raw/       my downloads (gitignored)
     public/data/    processed game data per city: public/data/la/, public/data/houston/
     tests/          Playwright smoke tests
3. Add scripts: "dev" (vite + server together), "build", "shot" (Playwright: open the game,
   wait for the world, drive forward 3 seconds, save screenshots to shots/), "test".
4. Install three, vite, express, ws, dotenv, qrcode, @anthropic-ai/sdk, playwright
   (+ chromium). Python: requests, pillow, shapely, pandas.
5. Create .env.example from BUILD_PLAN.md, .gitignore (.env, data/raw, node_modules, shots).
6. Create PROGRESS.md with a checklist of Phases 1 to 10.
Commit as "phase 0: scaffold".
```

### Master prompt (paste second)

```
You are building Grand Property Auto overnight, unattended. Work through Phases 1 to 10 in
BUILD_PLAN.md in order. For each phase: read its prompt in BUILD_PLAN.md, do it, run
`npm run build` and `npm run shot`, look at the screenshots and fix anything broken,
check it off in PROGRESS.md, commit. Then go straight to the next phase.

Never stop to ask me anything. If something is ambiguous, pick the option that makes the
demo better for CoStar's judges and log it in DECISIONS.md. If an API key or file is
missing, build against mock data with the same shape and note it in DECISIONS.md under
"Needs real data". If an API call fails twice, cache what you have and move on.

When all ten phases are checked, write "ALL PHASES DONE" at the bottom of PROGRESS.md
and write MORNING.md: what works, what is mocked, what I need to do by hand, and the
exact commands to run the demo.
```

### Phase 1: Data discovery and picking the neighborhood

```
Phase 1. Goal: understand the real data and pick the best neighborhood to build.

1. Inspect everything in data/raw/costar/ and data/raw/vexcel/. For each of the eight
   CoStar datasets and both starter CSVs, write to data/SCHEMA_NOTES.md: record count,
   the fields we care about (id, lat/lon or address, price, rent, beds, baths, sqft,
   year built, HOA, photos, pool, property type), and the join keys between them.
   Residential listing joins to Listing features and to Matterport models via a starter
   CSV. Apartment listing joins to Commercial property.
2. Write tools/pick_area.py: for LA and for Houston, put every residential listing and
   apartment listing that has at least one Matterport model on a 1 km grid, and rank the
   cells by count. Print the top 5 per city with center lat/lon. Pick the best 1.5 km x
   1.5 km box per city (it can span neighboring cells) and save to data/areas.json as
   {city, name, center:[lat,lon], bbox:[minLon,minLat,maxLon,maxLat]}.
3. If data/raw/costar is empty, write tools/make_mock_data.py instead: a believable
   suburban neighborhood (street grid, lots, house footprints, 80 listings with prices,
   beds, baths, sqft, pool flags, fake Matterport ids) in the same output format as
   Phase 2, so every later phase works. Mark MOCK in DECISIONS.md.
Done when data/areas.json exists for both cities (or mock) and SCHEMA_NOTES.md is filled.
```

### Phase 2: Data pipeline (Vexcel + CoStar to game files)

```
Phase 2. Goal: turn raw data into small, fast game files. The game must never call
Vexcel live during a demo; everything is cached.

Write tools/build_city.py --city la (and houston). It must:
1. Vexcel Elements: fetch building footprints, parcels and attributes for the bbox in
   data/areas.json. Endpoint from the slides:
     GET https://api.vexcelgroup.com/v2/property/extract?wkt=...&srid=4326&api_key=KEY
   Try a POLYGON for the whole bbox first. If it only accepts POINTs, sample a grid of
   points (about every 25 m) and dedupe buildings by id or geometry. Cache every raw
   response under data/cache/vexcel/ keyed by request hash so reruns are free. Sleep
   between calls and back off on 429.
   Save public/data/<city>/buildings.geojson with, per building: footprint polygon,
   height in meters (from an Elements height attribute if present, else from the Elevation
   DSM minus DTM if available, else 7 m for houses and 12 m for others; log which), roof
   material, solar, and the parcel's pool and tree cover flags.
2. Vexcel ortho: fetch the bbox as a grid of tiles with
     GET https://api.vexcelgroup.com/v2/ortho/extract?layer=urban&bbox-dimensions=W,H&zoom=Z&wkt=POINT(lon lat)&srid=4326&api_key=KEY
   Use 150 m tiles at zoom 19, stitch with Pillow into public/data/<city>/ground.jpg
   (max 8192 px on the long side, JPEG quality 80) and save its exact bounds in
   ground.json. Cache the tiles.
3. Elevation: if the tutorial gives an endpoint, fetch DTM for the bbox, downsample to a
   129 x 129 heightmap in public/data/<city>/terrain.json. If not, write a flat terrain
   and note it.
4. Listings: join CoStar residential listings + listing features + the home to Matterport
   CSV, plus apartment listings + commercial property + property to Matterport CSV, for
   records inside the bbox. Save public/data/<city>/listings.json, one object per home:
   {id, kind:"sale"|"rent", address, lat, lon, price or rent, beds, baths, sqft,
    yearBuilt, hoa, features[], photos[], matterportIds[], buildingId}
   Match each listing to the Vexcel building footprint that contains its point (nearest
   within 30 m if none contains it) and copy the pool and tree flags across.
5. Commercial scenery: commercial properties inside the bbox to
   public/data/<city>/commercial.json (name, type, size, tenants count, last sale) for
   quick info cards.
6. Write tools/check_data.py that prints counts and fails if listings have no buildingId
   or no lat/lon. Run it.
Done when both cities have buildings.geojson, ground.jpg, listings.json (or mock), and
check_data.py passes.
```

### Phase 3: The world

```
Phase 3. Goal: a good looking, fast 3D neighborhood from the Phase 2 files.

1. src/geo.js: lat/lon to local meters around the area center (equirectangular is fine
   at 1.5 km). Same function everywhere.
2. src/world.js: load ground.jpg onto a ground mesh using ground.json bounds and
   terrain.json heights. Extrude every footprint to its height. Merge all buildings into a
   few BufferGeometries (by material) so it runs at 60 fps on a laptop. Roofs get the
   ortho texture projected from above so roofs match the aerial photo; walls get a few
   warm stucco and siding colors with slight variation. Buildings that have a listing get a
   tiny bit of emissive so they read as interactive.
3. Scatter instanced low poly trees on parcels with tree cover and a blue pool plane on
   parcels with a pool.
4. Sky gradient, sun light with soft shadows on a limited shadow camera that follows the
   player, light fog at the edges so the 1.5 km boundary fades out. Invisible walls at the
   bbox edge.
5. A city switcher (LA / Houston) that reloads the world.
Done when the screenshot shows a recognizable neighborhood with roofs matching the aerial
image and the fps counter stays above 50 in the Playwright run.
```

### Phase 4: Car, camera, controls

```
Phase 4. Goal: driving that feels fun, arcade style, not a simulator.

1. src/car.js: a simple low poly car (boxes and cylinders, a nice color). Arcade physics:
   acceleration, braking, reverse, speed dependent steering, drift when turning hard at
   speed, ground following with the terrain, collision against building footprints
   (2D point in polygon with a spatial grid; slide along walls instead of stopping dead).
2. src/camera.js: smooth chase camera with a bit of lag, pulls back as speed rises, press C
   for a top down view. Mouse drag orbits briefly then springs back.
3. Controls: WASD and arrows, Space handbrake, Shift boost, R reset to road. Gamepad
   support through the Gamepad API.
4. Engine sound that rises in pitch with speed (Web Audio oscillator is fine), a tire
   squeal on drift.
Done when the Playwright shot after driving shows the car moved and is not inside a
building.
```

### Phase 5: Listings in the world, cards, minimap

```
Phase 5. Goal: homes are the point of interest everywhere you look.

1. src/listings.js: a GTA style floating marker above every listing building: a slowly
   rotating house icon on a light beam. Green for sale, blue for rent, size by price. Use
   instancing.
2. When the car is within 25 m of a listing, show a listing card (src/hud.js) sliding in
   from the right: photo, price, beds/baths/sqft, address, top features, a "Pool seen from
   the air" badge when Vexcel agrees with the listing, and prompts:
   "E  Walk inside" (only if it has a Matterport id) and "F  Save".
3. Commercial buildings: within 25 m, a small gray card with name, type, size, tenants.
4. src/minimap.js: bottom left circular minimap that rotates with the car, drawn from the
   ortho image, with listing dots and the mission target.
5. Speedometer bottom right. Saved homes counter top right.
Done when driving next to a listing in the Playwright test makes the card appear.
```

### Phase 6: Walk inside (Matterport)

```
Phase 6. Goal: the signature moment, from the curb to inside the real home.

1. src/tour.js: on E, play a quick transition (car stops, camera swoops toward the front
   door, fade to white), then open a full screen Matterport Showcase iframe for the
   listing's first matterportId using MATTERPORT_SHOWCASE_BASE and MATTERPORT_SDK_KEY.
   Follow the Matterport quickstart in data/raw for the exact URL params and SDK connect
   call.
2. Use the Showcase SDK to: start at the entrance sweep, show a small overlay with the
   listing price and a room list if room data is available, and listen for Esc or an
   "Exit to car" button to fade back to the car exactly where you left it.
3. If the home has several models, a "Next space" button.
4. Stretch, only if quick: a "See it empty" toggle if the defurnished panoramas from the
   kit are available for that model.
5. If no SDK key or the iframe fails, show the listing photos as a swipeable gallery so the
   flow never breaks, and log it.
Done when E opens the tour (or the fallback gallery in mock mode) and Esc returns to the
car.
```

### Phase 7: Voice missions

```
Phase 7. Goal: talk to the game and it reacts in the world, never a chat window.

1. src/voice.js: hold V (or the mic button) to talk, using the Web Speech API. Show live
   captions at the bottom center while talking. Fallback: press T to type one line.
2. server /api/mission: send the transcript plus the current filters and the last rated
   home to Claude (model from env, default a fast Sonnet). Ask for JSON only:
   {filters:{kind, minPrice, maxPrice, minBeds, minBaths, minSqft, pool, features[]},
    near:[text queries like "park", "school"], relative:"cheaper"|"bigger"|"closer"|null,
    say:"one short sentence to speak back"}
   Validate the JSON; on failure retry once, then fall back to a local keyword parser in
   src/missions.js so it still works offline.
3. "near" queries: use Vexcel semantic search
     GET https://api.vexcelgroup.com/v2/embedding/extract?search-text=park&layer=urban&wkt=POINT(lon lat)&buffer-meter=800&total-records=10&page-size=10&page=1&api_key=KEY
   through the server proxy. Precompute and cache "park", "school", "shopping center",
   "pool", "playground" for every listing during Phase 2 so missions are instant; only
   call live for new words, with a 3 s timeout.
4. src/missions.js: score every listing against the filters, highlight the top 5 (others
   dim), pick the best, and guide the player: a glowing GPS ribbon on the ground toward it
   plus an arrow at the top of the screen with the distance. Speak the "say" line with
   speechSynthesis (or TTS_API_KEY if set).
5. On arrival, /api/narrate gets a two sentence narration from the listing data and the
   Vexcel facts (pool, trees, roof, solar, nearby park). Speak it and show it as a caption.
6. After a tour, a thumbs up / thumbs down prompt. Up saves it. Either way the next voice
   line can be relative ("cheaper", "something with a bigger yard") and is applied to the
   last home.
Done when a Playwright test can inject the transcript "three bedrooms under 900k with a
pool" and a target gets highlighted with the GPS ribbon drawn.
```

### Phase 8: Phone as the controller

```
Phase 8. Goal: the CoStar MatterFlight idea for our game: scan a QR code and your phone
becomes the steering wheel while the laptop is the screen.

1. server: a websocket relay with rooms. The game creates a room and shows a QR code
   (top left, collapsible) linking to /phone?room=ID on the laptop's LAN IP, or on the
   ngrok URL if NGROK_AUTHTOKEN is set (start the tunnel from the dev script).
2. /phone page (mobile first): tilt to steer (DeviceOrientation, with the iOS permission
   button), big gas and brake pads, a hold to talk mic button that sends speech to the
   game, and an E / F action button that changes to match the current card. Haptic buzz
   on collisions and arrivals (navigator.vibrate where supported).
3. The phone shows the current listing card too, so the buyer can save homes from their
   pocket. A "My saved homes" tab on the phone.
4. Keyboard keeps working when no phone is connected.
Done when a Playwright test with two pages (game and phone) can send a steer and gas
message and the car moves.
```

### Phase 9: Polish and demo mode

```
Phase 9. Goal: it has to look and feel like a game in the first five seconds.

1. Title screen: aerial flyover of the neighborhood, logo "Grand Property Auto" in a bold
   original style (do NOT copy the GTA logo, font or artwork; Rockstar's trademarks stay
   out of it), city choice,
   "Press Enter or scan to play", small "Powered by CoStar, Matterport, Vexcel" line.
2. Spawn intro: camera drops from the sky to the car.
3. HUD polish: consistent font, rounded cards, subtle animations, nothing that looks like
   a chat box.
4. Saved homes screen (Tab): side by side compare of saved homes, cheapest first.
5. Demo mode (press 0): an autopilot run for the video: voice mission plays a canned
   transcript, car drives along the GPS ribbon, arrives, narration, walks inside for 10
   seconds, exits, rates, next mission "something cheaper", repeat. This is the backup if
   venue wifi fails.
6. Offline check: with the server stopped and network off, the game still loads, drives,
   shows cards and uses the local mission parser.
7. Performance pass: 60 fps on an integrated GPU, under 40 MB total download per city.
Done when demo mode runs a full loop in Playwright and you record shots of each step.
```

### Phase 10: Ship it

```
Phase 10. Goal: everything a judge or teammate needs.

1. README.md: what it is, the three data sources and exactly what each is used for,
   screenshots from shots/, how to run (npm install, .env, npm run dev), how to rebuild
   data (python tools/build_city.py --city la).
2. DEMO_SCRIPT.md: a 2 minute live demo script. Open on the funnel problem from the
   CoStar keynote, scan the QR code, voice mission, drive, walk in, "something cheaper",
   compare saved homes. Note which judge cares about which part (Vexcel: aerial city and
   semantic search; Matterport: interiors; CoStar data platform: listings and joins).
3. DEVPOST.md: inspiration, what it does, how we built it, challenges, accomplishments,
   what's next.
4. Production build: `npm run build`, serve dist with the Node server so one command runs
   everything. Make sure no API key reaches the browser bundle (grep dist for the keys).
5. Write MORNING.md and "ALL PHASES DONE" in PROGRESS.md.
```

---

## Part 4: Morning checklist (for you)

1. Read `MORNING.md` and `DECISIONS.md` ("Needs real data" first).
2. If anything ran on mock data, drop in the real files and run `python tools/build_city.py --city la`.
3. `npm run dev`, scan the QR code with your phone, try three voice missions.
4. Record the backup video with demo mode (press 0).
5. Show it to a CoStar mentor early. Ask which part they would cut or push further, since they're the judges.

## Scope guardrails (tell Claude Code if it drifts)

* One 1.5 km neighborhood per city. No roads or traffic AI. No pedestrians. No multiplayer.
* The LLM never renders a chat window. It only produces filters and short spoken lines.
* Nothing calls Vexcel live during the demo except brand new semantic search words, with a timeout.
* If time runs short, cut in this order: Houston, phone controller, "See it empty", gamepad. Never cut walking inside or voice missions.
