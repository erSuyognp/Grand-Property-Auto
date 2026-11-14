# Grand Property Auto: Overnight Build Plan for Claude Code

**Grand Property Auto** is a GTA style browser game for home buyers. You drive a real LA or Houston neighborhood built from Vexcel aerial data, pull up to homes for sale or rent from the CoStar data kit, and walk inside the real Matterport scan. Free roam by default, with voice missions ("three beds under $900k with a pool") that light up matches and guide you there.

Built for the HackPrinceton Fall 2026 CoStar track ("Inside and Out: AI for the Built World"). The judges' theme: AI is an input, not a chat window. Voice first, phone as a controller, and an experience that follows a nonlinear conversation instead of a search funnel.

---

## Part 0: Rules from the CoStar data agreement (Claude Code must follow these)

The Sponsor Data agreement (saved at `data/raw/terms.txt`) sets hard limits. In short:

1. **Use the data only between Fri Nov 13 4:30 PM and Sun Nov 15 4:00 PM EST.** No API calls outside that window.
2. **The data never leaves this laptop.** No GitHub push of any data, cache, sample, screenshot or schema note. No cloud hosting (no Vercel, no Cloudflare Pages). No tunnels (no ngrok); the phone controller works over the same wifi or the laptop's hotspot.
3. **Schemas, non public API details and credentials are confidential too.** `data/SCHEMA_NOTES.md`, `data/VEXCEL_NOTES.md`, `data/MATTERPORT_SCHEMA.md` and `data/samples/` stay local and gitignored. The repo stays **private**.
4. **Nothing confidential in public demos.** Anything public (Devpost screenshots, a public video) is made in **mock mode** with the synthetic neighborhood. Real data is shown only live to the judges.
5. **Delete everything right after the event.** That covers every copy, extract, cache and derivative: `data/`, `public/data/`, `shots/`, browser caches, and the Claude Code session logs for this project. `tools/purge.sh` does it.
6. **Only permissive open source** (MIT, BSD, Apache 2.0, ISC). No GPL, LGPL or AGPL dependencies without CoStar's written OK.
7. **No third party sharing.** Whether sending data to the Anthropic API (Claude Code itself, and the in game mission parser and narration) counts as sharing is **unconfirmed**. Until CoStar confirms in writing it's fine, `LLM_ENABLED=false` by default: the game uses the local keyword parser and template narration, and the server sends only the spoken words and a few listing numbers (no addresses, no agent data) when it is turned on.

---

## Part 1: What to collect before you sleep

Put every key in `.env` (never commit it). Put every file under `data/raw/`.

### Required

| # | What | Where to get it | What Claude Code needs from it |
|---|------|-----------------|--------------------------------|
| 1 | **Vexcel API key** (have it) | The CoStar bot in Discord, or the CoStar table | `VEXCEL_API_KEY`. Sent as the `X-API-KEY` header |
| 2 | **Vexcel tutorial PDF + `vexcel_quickstart.py`** (have them) | Hackathon materials | Save both to `data/raw/vexcel/`. Claude Code copies the helpers (`send` with 429 backoff, `to_wkt`, `square_around`) |
| 3 | **Matterport API key, API token, SDK key** (have them) | The bot's "Matterport GraphQL + SDK" card | `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`, `MATTERPORT_SDK_KEY`. The token is the same `hp_token` that's in the Model Playground link and **expires about Nov 21**, after judging. The `#key=` part at the end of that link is probably the API key; check it matches |
| 4 | **Matterport quickstart page, saved** | `beta-app.matterport.com/2026-princeton-hackathon/quickstart` | Save the whole page (Print to PDF, or copy the text) to `data/raw/matterport/quickstart.pdf`. Also open the Model Playground link once and copy one working example query into `data/raw/matterport/example_query.graphql`. Claude Code can't log in to read these pages |
| 5 | **CoStar data kit zip + its password** (have it) | The bot's "CoStar Data Extract" card | **Download it now: the link expires 24 hours after it was issued (about 1:27 AM Sunday).** Unzip with the password into `data/raw/costar/` so `data/raw/costar/index.md` exists. Never put the password in git |
| 5b | **The separate "how to connect to the Matterport models" zip** | The kit's index.md says it is "provided in a separate zip file". Ask the bot or the CoStar table if it isn't on your card | Unzip into `data/raw/matterport/`. This is probably what links a `MatterportModelId` to the GraphQL API and the tour URL |
| 6 | **LLM API key** | Anthropic console (or a sponsor credit if HackPrinceton gives one) | `ANTHROPIC_API_KEY`. Used only to turn speech into filters and write short arrival narration |

### Optional (the build works without these)

| What | Why | Key |
|------|-----|-----|
| ElevenLabs or OpenAI TTS key | Nicer narrator voice. Only for template text with no Sponsor Data in it, unless CoStar OKs third party AI. The browser's built in speech works as a free fallback | `TTS_API_KEY` |

No tunnel and no hosting account: the agreement keeps the data on your laptop (Part 0).

### Not needed
Google Maps, Mapbox, Cesium Ion, Zillow. Everything visual comes from Vexcel and Matterport, which is what the sponsor wants to see.

### Vexcel facts (from the tutorial, the quickstart script and the CoStar bot)

Base URL `https://api.vexcelgroup.com/v2`. Key in the `X-API-KEY` header. WKT is always `POINT(lon lat)`, longitude first. Always send `srid=4326`. For ortho use `layer=urban,urban-r,wide-area,urban-g` (the API picks the best). Obliques exist only in `layer=urban`.

| Need | Endpoint | Notes |
|------|----------|-------|
| Parcels, buildings, pools, trees, roofs | `GET /property/extract` | Accepts a **POLYGON**, or a point plus `buffer-meter`, and returns **every parcel in the area**. Paged with `page` / `page-size`, **up to 500 per page**. `latest=true`. `include=precomputed` gives everything; a short list like `include=pool,roof-characteristics,footprint-wkt` is faster. Filters like `pool=true` or `roof-solar=true` turn it into a search. 404 means no parcel at that spot. Keys are flat dotted strings: `pool.detected`, `parcel-tree-cover.percent`, `building-type.class`, and per structure in `structures[]`: `primary-structure`, `footprint.area`, `roof-characteristics.material.class` |
| Building height | `include=calculated` on `/property/extract` | Gives **roof height and elevation**, but it is computed on demand and slow. Fine for an overnight pipeline with caching, never live. Fallback: DSM minus DTM |
| Ground and surface height | `GET/POST /dtm/elevation` and `/dsm/elevation` | Send any WKT (points, lines, polygons). It returns the **same geometry with a z value in meters on every coordinate** (POLYGON comes back as POLYGONZ). JSON fields: `collection`, `layer`, `srid`, `wkt`. DSM needs `layer` (`urban` or `wide-area`). The docs may have the DTM and DSM descriptions swapped, so verify with one known point (ground versus roof) |
| Top down image | `GET/POST /ortho/extract` | Returns JPEG/PNG/TIFF **bytes, not JSON**. `crop=bounding_box`, `zoom` or `destination-dimensions`. **One extract is capped at 1,024 tiles of 256 px**, so a 1.5 km box fits in one call at zoom 19 but needs about 4 calls at zoom 20. Image metadata (bounds) is in the file's XMP header |
| Angled photos of a house | `GET /oriented/collections` then `POST /oriented/extract` | Check which of `oblique-north/south/east/west` exist first or the call errors. `rotation=natural`, `crop=bbox`, `downsample` to keep files small |
| Find anything by name, live | `POST /elements/detect` | sam3 model, several seconds per call. Keep areas small. Not for live gameplay; optional precompute only |
| Semantic search | `POST /embedding/extract` | Zoom 19 tiles, about 60 m each. Bound it with a `wkt` polygon. Exactly **one** of `search-text`, `search-location` (POINT, "more like this"), `search-url`, `search-image`, `search-vector`. Scores are relative within one search |
| Rate limits | | No published numbers. On 429, back off about 1, 2, 4, 8, 16 s with jitter and **don't run requests in parallel** |

### Matterport facts
* The hackathon runs its own GraphQL API on `beta-app.matterport.com/2026-princeton-hackathon/`. The playground authenticates with `hp_token`. Claude Code introspects the schema in Phase 1 instead of guessing field names.
* Docs: GraphQL API `developers.matterport.com/api/`, Embed SDK `developers.matterport.com/embed-sdk/` (the `matterport.github.io/developer-docs` links redirect there).
* **The SDK key only works on `localhost` (http or https).** So the walk inside tour runs when the game is served from localhost, which is how you'll demo it. A public hosted link won't load the Showcase tour; it falls back to our own skybox viewer.
* Showcase embed, from the docs: iframe `src = <showcase base>/show?m=<modelId>&play=1&applicationKey=<SDK key>`, then `connect(iframe)` from the SDK bundle (`sdk.es6.js?applicationKey=...`), then `mpSdk.Model.getData()`, actions like `mpSdk.<Namespace>.<action>()` and events with `mpSdk.on(...)`. Whether the base is `my.matterport.com` or `beta-app.matterport.com` for hackathon models: Phase 1 finds out.
* Per the slides, each model has: 6 skybox faces up to 4K per scan position, scan positions in the house and in the world, a point cloud, a textured OBJ mesh, room boundaries and room types, defurnished panoramas, and for about 232 models an exterior Gaussian splat (PLY).

### Still unknown (Claude Code handles both cases)
1. Exactly how the token and API key are sent to GraphQL (query param, `Authorization: Bearer`, or a key header) and the GraphQL URL. Read the saved quickstart and example query, then try each.
2. Which Showcase base URL opens hackathon models.
3. Any Matterport call caps. Cache every response to disk anyway.

### `.env.example`
```
VEXCEL_API_KEY=
MATTERPORT_API_KEY=
MATTERPORT_API_TOKEN=
MATTERPORT_SDK_KEY=
MATTERPORT_GRAPHQL_URL=https://beta-app.matterport.com/2026-princeton-hackathon/graphql
MATTERPORT_SHOWCASE_BASE=https://my.matterport.com
ANTHROPIC_API_KEY=
LLM_ENABLED=false
GAME_MODE=real
TTS_API_KEY=
```
(`MATTERPORT_GRAPHQL_URL` and `MATTERPORT_SHOWCASE_BASE` are best guesses; Phase 1 confirms both and writes the working values into DECISIONS.md.)

---

## Part 2: How to run it overnight

1. Make an empty folder, `git init` (local only, no GitHub remote), copy this file in as `BUILD_PLAN.md`, and save the agreement text as `data/raw/terms.txt`. Create `.env` from the example in Part 1 and fill in every key. Put the unzipped CoStar kit in `data/raw/costar/`, the Vexcel PDF and `vexcel_quickstart.py` in `data/raw/vexcel/`, and the saved Matterport quickstart and example query in `data/raw/matterport/`.
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
   - The seven data agreement rules from Part 0 of BUILD_PLAN.md, copied word for word at
     the top, marked as rules that override everything else.
   - Rules: never ask me questions, make the reasonable call and log it in DECISIONS.md.
     Never add a git remote and never push. Never commit .env or anything that holds
     Sponsor Data (see .gitignore). Commit after every phase with message "phase N: ...".
     Before adding any npm or pip dependency, check its license; only MIT, BSD, Apache 2.0
     or ISC. Log every dependency and its license in LICENSES.md.
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
   (+ chromium). Python: requests, pillow, shapely, pandas. All are MIT, BSD, Apache or
   similar; confirm and record them in LICENSES.md.
5. Create .env.example from BUILD_PLAN.md (add LLM_ENABLED=false and GAME_MODE=real|mock).
   .gitignore: .env, node_modules, dist, shots/, data/ (everything under it, including
   raw, cache, samples and the *_NOTES.md / *_SCHEMA.md files), public/data/ except
   public/data/mock/, test-results/, playwright-report/.
6. Mock mode: GAME_MODE=mock loads only public/data/mock/ (synthetic neighborhood from
   tools/make_mock_data.py, no Sponsor Data at all). This is the only mode allowed for
   anything public: Devpost screenshots, a public video, the README.
7. tools/purge.sh: deletes data/, public/data/la, public/data/houston, dist/, shots/,
   test-results/, the Playwright browser profile, and prints a reminder to also clear the
   browser cache for localhost and delete this project's folder under ~/.claude/projects/.
   Ask for confirmation before deleting.
8. Server: every Vexcel and Matterport call refuses to run outside Nov 13 4:30 PM to
   Nov 15 4:00 PM America/New_York and logs why.
9. Create PROGRESS.md with a checklist of Phases 1 to 10.
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

1. Read data/raw/costar/index.md first, then models/residential-listings.md,
   models/residential-listing-features.md, models/apartment-listing.md,
   models/commercial-property.md and concepts/residential-listings-and-sales.md. Data is
   JSON Lines in data/raw/costar/data/<dataset>.jsonl (load with
   pandas.read_json(lines=True) or json.loads per line; never run expand_records.py on
   everything, it writes 1 GB). Enums are integers: decode with schemas/enums.json.
   Write data/SCHEMA_NOTES.md with the exact field paths we use. Known from index.md:
   - Homes: residential-listings.jsonl `id` = residential-listings.csv `ListingId`.
     Location is `property.address` (has latitude and longitude). Lot size is
     `property.lotSizeAcresMin` (acres). Rentals give monthly rent. `permissionLevels.homes`
     marks the 228 listings not shown publicly. 4 listings hide their street address.
     Status: 793 current (Active or Contract), 1,321 sold or rented in the last year,
     6 inactive. Texas sold homes carry the asking price only (non disclosure state).
   - Home features: residential-listing-features.jsonl `id` = listing `id` (1 to 1;
     221 listings have none). Holds highlights, feature sentences by section (Kitchen,
     Parking, Schools...), totals like bedrooms and HOA fees.
   - Home Matterport models: `media[]` items whose `externalReferenceType` is 36
     (MatterportScan) or 234 (MatterportStreamingKey); the model id is `videoKey`. The CSV
     has one row per listing and model. Several listing ids can be one home: group by
     `ResidentialListingId` so a home shows once.
   - Apartments: apartment-listing.jsonl (1,747, one per `propertyId`) has asking rents and
     units available per floor plan, management company and main photo. Join `propertyId`
     to commercial-property.jsonl `id`; floor plans join `apartmentModels[].id` to
     `propertyApartment.models[].id`. Apartment Matterport models live in
     `attachments[].videoKey`, `propertyApartment.models[].attachments[].videoKey` and
     `propertyApartment.models[].units[].attachments[].videoKey` (type 36 or 234), and in
     commercial-properties.csv. Building location is `primaryAddress` (lat/lon).
   - Photos: `attachmentUri` links to CoStar's CDN at size 112; replace `/112/` with
     `/113/` (1400x720) or `/116/` (2048x2048).
   - Emails and phone numbers are fake. Don't show agent contact details in the game.
2. Write tools/pick_area.py: for LA and for Houston, put on a 1 km grid every home that is
   public (`permissionLevels.homes`), not inactive, and has a Matterport model, plus every
   apartment community with an apartment listing and a Matterport model. Weight current
   listings 3, sold or rented in the last year 1, apartment communities 2. Rank the cells,
   print the top 5 per city with center lat/lon and counts by kind. Pick the best
   1.5 km x 1.5 km box per city (it can span neighboring cells) and save to
   data/areas.json as {city, name, center:[lat,lon], bbox:[minLon,minLat,maxLon,maxLat],
   counts}.
3. Always write tools/make_mock_data.py: a believable but entirely invented suburban
   neighborhood (street grid, lots, house footprints, a procedural ground texture, 80
   listings with made up addresses, prices, beds, baths, sqft, pool flags, procedural
   "interior" cube maps instead of Matterport scans) in the same format as Phase 2, saved
   to public/data/mock/. It must contain zero Sponsor Data (don't sample real values from
   the kit). This powers GAME_MODE=mock for public screenshots and video, and is the
   fallback if real data is missing (log MOCK in DECISIONS.md).
4. Vexcel smoke test: write tools/vexcel.py, a small client copied from the helpers in
   data/raw/vexcel/vexcel_quickstart.py (X-API-KEY header, send() with 429 backoff,
   to_wkt, square_around) plus a disk cache keyed by a hash of method + path + params +
   body. Run three calls at the center of each area and save the responses to
   data/samples/: property/extract with include=precomputed (one parcel),
   property/extract with include=calculated (same parcel, note how slow it is and whether
   it has roof height), and dtm/elevation + dsm/elevation for a MULTIPOINT of one roof
   point and one street point. Write data/VEXCEL_NOTES.md: real field names, whether
   height is available, which of DTM/DSM returns ground (the docs may have them swapped),
   and timing per call.
5. Matterport discovery: read everything in data/raw/matterport/ (the connection zip,
   quickstart*, example_query.graphql).
   Find the GraphQL endpoint and how auth is sent: try ?hp_token=MATTERPORT_API_TOKEN,
   then Authorization: Bearer <token>, and add MATTERPORT_API_KEY as a header or param if
   the quickstart says so. Run an introspection query and save the schema to
   data/MATTERPORT_SCHEMA.md (types and fields only, readable). Then fetch one model from
   the starter CSV and save the JSON to data/samples/. Find the fields for: sweeps or scan
   positions with their 3D positions, skybox face image URLs, defurnished panoramas, rooms
   with types and sizes, address or lat/lon, mesh and splat downloads, and any Showcase or
   share URL. Note which exist.
6. Showcase check: write tools/showcase_test.html served by Vite on localhost. It embeds
   one model with <base>/show?m=<id>&play=1&applicationKey=MATTERPORT_SDK_KEY and calls
   connect() from the Embed SDK, then logs mpSdk.Model.getData(). Try base
   my.matterport.com first, then beta-app.matterport.com, then any share URL from the
   GraphQL data. Use Playwright to load it and record which one connects. Write the
   working base URL to DECISIONS.md. If none connect, say so; Phase 6 then uses only our
   own viewer.
Done when data/areas.json exists for both cities (or mock), SCHEMA_NOTES.md,
VEXCEL_NOTES.md and MATTERPORT_SCHEMA.md are filled, and sample responses are saved.
```

### Phase 2: Data pipeline (Vexcel + CoStar to game files)

```
Phase 2. Goal: turn raw data into small, fast game files. The game must never call
Vexcel live during a demo; everything is cached.

Write tools/build_city.py --city la (and houston). It must:
Use tools/vexcel.py from Phase 1 for every call (X-API-KEY header, cache, 429 backoff,
one request at a time, never parallel). Read data/VEXCEL_NOTES.md for real field names.

1. Vexcel Elements: GET /property/extract with wkt = the area bbox as a POLYGON,
   srid=4326, layer=urban,urban-r,wide-area,urban-g, latest=true, page-size=500, and
   loop page=1,2,3... until a page comes back short. Use the smallest include list that
   covers footprints, pool, tree cover, building type and roof (fall back to
   include=precomputed if the short list misses something). If a bbox call errors for
   size, split the bbox into 4 and recurse.
   Building heights, in this order, logging which source each building used:
     a. include=calculated roof height, fetched per parcel only for parcels that hold a
        listing or are within 300 m of the area center (it is slow; cache it).
     b. For every other building: one POST /dsm/elevation and one POST /dtm/elevation per
        batch of up to 500 footprint centroids as a MULTIPOINT; height = DSM z minus DTM z,
        clamped to 3 to 60 m. Use whichever endpoint VEXCEL_NOTES.md says returns ground as
        the DTM.
     c. Default 7 m for single family, 12 m for anything else.
   Save public/data/<city>/buildings.geojson with, per building: footprint polygon,
   height, building type, roof material and shape, solar, and the parcel's pool flag,
   pool area and tree cover percent.
2. Vexcel ortho ground image: POST /ortho/extract with wkt = the bbox POLYGON,
   layer=urban,urban-r,wide-area,urban-g, crop=bounding_box, image-format=jpeg, zoom=19
   (fits under the 1,024 tile cap for 1.5 km). If time allows, also fetch zoom 20 as a
   2 x 2 split and stitch it. Read the exact image bounds from the JPEG's XMP metadata and
   save them to public/data/<city>/ground.json. Resize to at most 8192 px on the long side
   (quality 80). Check alignment: draw 20 footprints on the image with Pillow, save to
   data/samples/align_<city>.jpg and look at it. If footprints don't sit on roofs, fix the
   bounds or projection (the image may be Web Mercator) before moving on.
3. Terrain: one POST to the ground elevation endpoint with a MULTIPOINT grid of
   65 x 65 points over the bbox (split into batches if needed). Save the z values as
   public/data/<city>/terrain.json. If heights vary by less than 2 m, mark the city flat.
4. Curb photos: for each listing building (from step 5 below, run it first), call
   GET /oriented/collections for its parcel, then POST /oriented/extract for every
   available oblique direction with rotation=natural, crop=bbox, buffer-meter=8,
   downsample so the long side is about 800 px. Save to
   public/data/<city>/curb/<listingId>_<dir>.jpg. These are real angled photos of the
   house from the air, for the listing card.
5. Listings: using SCHEMA_NOTES.md, for records inside the bbox, join residential
   listings + listing features + residential-listings.csv (public ones only, one entry
   per ResidentialListingId), and apartment listings + commercial property +
   commercial-properties.csv. Save public/data/<city>/listings.json, one object per home
   or apartment community:
   {id, kind:"sale"|"rent"|"apartments"|"sold", status, address, lat, lon,
    price (sale or asking), rent (monthly), beds, baths, sqft, lotAcres, yearBuilt, hoa,
    highlights[], features{section:[sentences]}, photos[] (CDN size 113),
    matterportIds[], buildingId,
    floorPlans[] for apartments: {name, beds, baths, sqft, rentMin, rentMax,
    unitsAvailable, matterportIds[]}}
   "sold" covers homes sold or rented in the last year: they stay tourable but show
   "Recently sold" and, in Texas, "Asking price" instead of a sale price.
   Match each listing to the Vexcel building footprint that contains its point (nearest
   within 30 m if none contains it) and copy the pool and tree flags across. Add
   curbPhotos[] from step 4 and vexcel:{poolDetected, poolAreaSqft, treeCoverPct,
   roofMaterial, roofCondition, solar}.
6. Semantic "nearby" index: for each of "park", "school", "shopping center",
   "playground", "tennis court", "water" run ONE POST /embedding/extract over the whole
   bbox plus a 1 km margin (include=score,geometry, total-records=50). Save the tile
   centers and scores to public/data/<city>/nearby.json, and for every listing store the
   distance to the nearest strong match of each word. Six calls per city total.
7. Matterport per listing: for every listing with matterportIds, fetch and cache (using
   the fields found in MATTERPORT_SCHEMA.md) the scan positions, skybox face URLs (or
   download the faces at 2K to public/data/<city>/mp/<modelId>/ if URLs expire),
   defurnished panoramas if present, and rooms. Save public/data/<city>/mp/<modelId>.json.
   Cap at the 40 listings closest to the area center if downloads are big, and log it.
8. Commercial scenery: commercial properties inside the bbox to
   public/data/<city>/commercial.json (name, type, size, tenants count, last sale) for
   quick info cards.
9. Write tools/check_data.py that prints counts and fails if listings have no buildingId
   or no lat/lon. Run it.
Done when both cities have buildings.geojson, ground.jpg aligned with footprints,
listings.json with curb photos, nearby.json, Matterport JSON for the listings (or mock),
and check_data.py passes.
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
   rotating house icon on a light beam. Green for sale, blue for rent, purple for
   apartment communities (a building icon), gray and smaller for recently sold. Size by
   price. Use instancing. A legend and a filter toggle (1 to 4 keys) for each kind.
   Apartment cards list floor plans with rent ranges and units available; E then asks
   which floor plan to walk into.
2. When the car is within 25 m of a listing, show a listing card (src/hud.js) sliding in
   from the right: photo, price, beds/baths/sqft, address, top features, a strip of the
   Vexcel curb photos (the angled aerial shots from Phase 2, click to enlarge), badges
   built from Vexcel facts ("Pool seen from the air", "Solar roof", "42% tree cover",
   "Park 300 m away"), and prompts:
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

Two paths. Path A (Showcase) is the main one when Phase 1 found a working Showcase base
URL and the game runs on localhost (the SDK key only allows localhost). Path B (our own
skybox viewer) is used when Showcase isn't available, on a hosted build, or as the
fallback if the iframe fails to connect within 8 seconds. Build A first, then B.

1. src/tour.js: on E, play a quick transition (car stops, camera swoops toward the front
   door, fade to white), then open the interior for the listing's first matterportId.
Path A:
A1. Full screen iframe <base>/show?m=<id>&play=1&applicationKey=SDK key, connect() with
   the Embed SDK. Use the SDK reference (developers.matterport.com/reference/) to: start
   at the first sweep, listen for sweep and room changes to update the overlay, and expose
   moveTo for the phone controller (Phase 8) so the phone can walk you between rooms.
A2. Same overlay as B3 below (price, room, buttons), drawn over the iframe.
Path B:
2. Interior viewer (Three.js, same renderer): at the current scan position, show the 6
   skybox faces as a cube map around the camera. Drag or tilt the phone to look around.
   Show the other scan positions as glowing floor discs placed by their 3D positions;
   click one (or press W toward it) to glide there with a short crossfade between the two
   cube maps. Start at the scan nearest the front door (lowest scan closest to the
   listing's street side), or the first one.
3. Overlay: price, the current room name and type (if rooms data exists), a mini floor map
   of scan dots, and buttons "See it empty" (swap to the defurnished panorama for this
   scan, if present), "Next space" (if the home has several models), "Exit to car" (Esc).
   Exit fades back to the car exactly where you left it.
4. A key T inside a tour toggles between Path A and Path B when both work, so the demo
   can show either.
5. If a model has no skybox data and Showcase fails, show the curb photos and listing photos as a swipeable
   gallery so the flow never breaks, and log it.
Done when E enters a home on localhost (Path A if Phase 1 found a working Showcase URL),
Path B lets you move between at least 3 scan positions, "See it empty" works where data
exists, and Esc returns to the car (gallery fallback in mock mode).
```

### Phase 7: Voice missions

```
Phase 7. Goal: talk to the game and it reacts in the world, never a chat window.

1. src/voice.js: hold V (or the mic button) to talk, using the Web Speech API. Show live
   captions at the bottom center while talking. Fallback: press T to type one line.
2. server /api/mission: send the transcript plus the current filters and the last rated
   home to Claude (model from env, default a fast Sonnet) ONLY when LLM_ENABLED=true.
   Send just the spoken words, the current filter values and price, beds, baths and
   sqft of the last rated home (no address, no ids, no agent data, no photos). When
   LLM_ENABLED=false (the default), go straight to the local keyword parser, which must
   handle every demo line in DEMO_SCRIPT.md on its own. Ask Claude for JSON only:
   {filters:{kind:"sale"|"rent"|"apartments"|"sold"|null, minPrice, maxPrice, minRent,
    maxRent, minBeds, minBaths, minSqft, minLotAcres, pool, features[]},
   (features[] are matched against the listing's highlights and feature sentences, e.g.
   "island kitchen", "garage", "good schools")
    near:[text queries like "park", "school"], relative:"cheaper"|"bigger"|"closer"|null,
    say:"one short sentence to speak back"}
   Validate the JSON; on failure retry once, then fall back to a local keyword parser in
   src/missions.js so it still works offline.
3. "near" queries: answer from public/data/<city>/nearby.json (built in Phase 2), so
   missions are instant. For a word not in the index, the server calls
   POST /embedding/extract once over the bbox (search-text=word, include=score,geometry,
   total-records=50) with a 4 s timeout, caches it, and scores listings by distance to
   the matches.
3b. "More like this": after a thumbs up, the line "find me more like this one" calls
   POST /embedding/extract with search-location=POINT(lon lat) of that home over the bbox,
   then ranks the other listings by the score of the tile they sit in. Cache results.
3c. Pool and solar filters use the Vexcel facts stored on each listing, so "with a pool"
   means a pool you can actually see from the air. Say so in the spoken reply when a
   listing's own data disagrees ("This one says no pool, but there's one in the
   backyard").
4. src/missions.js: score every listing against the filters, highlight the top 5 (others
   dim), pick the best, and guide the player: a glowing GPS ribbon on the ground toward it
   plus an arrow at the top of the screen with the distance. Speak the "say" line with
   speechSynthesis (or TTS_API_KEY if set).
5. On arrival, speak a two sentence narration built from the listing data and the Vexcel
   facts (pool, trees, roof, solar, nearby park). Default: a local template system with
   several varied phrasings, no API call. Only when LLM_ENABLED=true, /api/narrate may
   send the same few numbers and Vexcel flags (no address, no ids) to Claude for a
   livelier line. Show it as a caption too.
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
   local network only. No tunnels: the phone must be on the same wifi or on the laptop's
   hotspot. If the venue wifi blocks device to device traffic, the hotspot is the fix.
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

1. README.md: what it is, the three data sources and what each is used for (in general
   terms, no field names or endpoint details), screenshots taken in GAME_MODE=mock only
   (save them to docs/mock_shots/), how to run (npm install, .env, npm run dev), how to
   rebuild data (python tools/build_city.py --city la), and a "Data handling" section:
   data stays local, deleted after the event with tools/purge.sh.
2. DEMO_SCRIPT.md: a 2 minute live demo script. Open on the funnel problem from the
   CoStar keynote, scan the QR code, voice mission, drive, walk in, "something cheaper",
   compare saved homes. Note which judge cares about which part (Vexcel: aerial city and
   semantic search; Matterport: interiors; CoStar data platform: listings and joins).
3. DEVPOST.md: inspiration, what it does, how we built it, challenges, accomplishments,
   what's next. No confidential details: no schemas, field names, endpoint paths, record
   counts or real addresses. Images only from docs/mock_shots/.
3b. Run a confidentiality check: grep every tracked file (git ls-files) for real
   addresses, listing ids, model ids, API hostnames other than in .env.example, and the
   keys. Fix anything found. Confirm `git remote -v` is empty.
4. Production build: `npm run build`, serve dist with the Node server on
   http://localhost so one command runs everything and the Matterport SDK key still works.
   The only key allowed in the browser bundle is MATTERPORT_SDK_KEY (it is a domain locked
   public key). Grep dist for the Vexcel key, the Matterport API key and token, and the
   Anthropic key, and fail the build if any appear.
5. Write MORNING.md and "ALL PHASES DONE" in PROGRESS.md.
```

---

## Part 4: Morning checklist (for you)

1. Read `MORNING.md` and `DECISIONS.md` ("Needs real data" first).
2. If anything ran on mock data, drop in the real files and run `python tools/build_city.py --city la`.
3. `npm run dev`, scan the QR code with your phone, try three voice missions.
4. Record the backup video with demo mode (press 0). Record one with real data for judges only (keep it on your laptop), and one in mock mode for anything public.
5. Show it to a CoStar mentor early. Ask which part they would cut or push further, since they're the judges.
6. Ask CoStar in the Discord channel, so the answers are in writing:
   * Is it OK to use Claude Code and the Anthropic API with the Sponsor Data? If yes, set `LLM_ENABLED=true`.
   * How should we submit code, given the repo must stay private? (Share a private repo, or a zip?)
   * Can the Devpost page and video show real imagery and tours, or should they be mock only?
7. **After 4:00 PM Sunday:** run `tools/purge.sh`, clear the browser cache for localhost, delete this project's folder under `~/.claude/projects/`, and remove the kit zip and any downloads.

## Scope guardrails (tell Claude Code if it drifts)

* One 1.5 km neighborhood per city. No roads or traffic AI. No pedestrians. No multiplayer.
* The LLM never renders a chat window. It only produces filters and short spoken lines.
* Nothing calls Vexcel live during the demo except brand new semantic search words, with a timeout.
* If time runs short, cut in this order: Houston, phone controller, "See it empty", gamepad. Never cut walking inside or voice missions.
