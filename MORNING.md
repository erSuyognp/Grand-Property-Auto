# Good morning

All ten phases are checked off. The game runs on real Houston and LA data and on the mock neighborhood, at 60 fps on this laptop's integrated GPU. Read "Needs you" first.

## Run the demo

```bash
npm run demo
```

Then open http://localhost:8787 in Chrome and press F11. That one command builds the game, checks that no server key is in the browser bundle, and serves everything from the Node server (the Matterport SDK key only works on localhost, which this is).

For development (hot reload):

```bash
npm run dev
```

Then open http://localhost:5173.

Other commands:

```bash
npm test
```

```bash
npm run shot
```

```bash
python tools/check_data.py houston la mock
```

```bash
python tools/check_confidential.py
```

Keys in the game: WASD drive, Space handbrake, Shift boost, C top view, L time of day, C cycles the three views, M the map, G Google 3D city or block city, N sound on or off, Q drone view (where offered), R reset, V hold to talk, T type instead, E walk inside, F save, Tab saved homes, 1 to 4 toggle kinds, X clear the mission, M mute, 0 demo mode. Inside a home: WASD to walk freely, click to look with the mouse (or drag, or arrow keys), Shift to run, G see it empty (photo view), T switch viewer (free walk, Matterport Showcase, photo spots), N next space, Esc exit.

## Needs you

1. **Decide `LLM_ENABLED`.** `BUILD_PLAN.md` says CoStar OK'd third party APIs in Discord, but `CLAUDE.md` rule 7 still has the old "unconfirmed, keep it off" text, and `.env` says `LLM_ENABLED=false`. I was not permitted to edit the override rules in `CLAUDE.md` and left the defaults alone. Right now the game uses the local keyword parser, template narration and the browser voice, and it works well that way. To turn on Claude (and the ElevenLabs narrator voice), set `LLM_ENABLED=true` in `.env` and restart, and update rule 7 in `CLAUDE.md` yourself so the two documents agree. I tested the Claude path once with an invented sentence and invented numbers only: 1.6 to 2.4 s per mission, 1.6 s per narration.
2. **Try a real phone.** The phone controller passes its test with a second browser page, but I could not hold a phone. Scan the QR code on the title screen. The phone will warn about the self-signed certificate once (Advanced, Proceed). If the page does not load, Windows Firewall is the likely cause: allow Node on private networks for ports 8443 and 8787, or use the laptop's hotspot. Tilt and the mic need the https link the QR code gives.
3. **Try your voice.** Speech recognition was only tested by injecting text. It needs Chrome, a mic permission click, and internet (the browser's speech service). T always works as the typed fallback.
4. **Listen to it.** I cannot hear. Engine, tire squeal, chimes and the narrator voice are untested by ear. M mutes the effects.
5. **`BUILD_PLAN.md` contains sponsor API hostnames and details** (your own notes). `tools/check_confidential.py` reports it as a warning. Remove it or keep it out of anything you share. The first Phase 1 commit also has three API terms in an old version of `DECISIONS.md`; if you ever share the git history rather than a zip of the files, squash first.
6. **After 4:00 PM Sunday:** `bash tools/purge.sh`, then the by-hand steps it prints. It now also deletes `tools/sponsor/` and `server/sponsor/` (see below).

## What works (checked by tests on real data)

- **World:** both cities build from the aerial data: ground photo at 8192 px, 1,710 buildings in Houston and 444 in downtown LA with real heights, roofs textured from the aerial photo, trees, pools, terrain, shadows, fog at the edge, invisible walls. City switcher on the title screen and in the game.
- **Driving:** arcade handling, drift, boost, sliding wall collisions, chase camera that stays out of buildings, top view, gamepad mapping (not tested with a real pad).
- **Listings:** Houston has 8 homes for sale, 15 recently sold and 10 apartment communities; LA has 6 for sale, 2 sold and 34 apartment communities. Markers by kind and price, legend and 1 to 4 filters, listing cards with aerial badges and four angled aerial photos per home, commercial cards, rotating minimap, speedometer, saved counter.
- **Walk inside:** the real Matterport Showcase through the Embed SDK (connects on localhost), my own panorama viewer as fallback and for "See it empty", room names and sizes, a floor map of scan positions, floor rings that point at the real positions (calibrated against the Showcase), photo gallery as the last resort. 47 Houston models and 65 LA models have panoramas on disk.
- **Voice missions:** filters, top five highlighted, gold route that mostly follows streets, arrow with distance, narration on arrival, thumbs up or down after a tour, follow ups ("cheaper", "bigger yard", "closer to a park", "more like this one"), and spoken commands ("take me inside", "save this one", "see it empty").
- **Aerial search:** "near a park / school / shops / playground / tennis / water" is instant from the prebuilt index. A new word ("coffee shop") makes one live search (about 1 s, cached). "More like this one" uses the visual search (0.2 s).
- **Phone controller:** QR pairing over the LAN, tilt or drag steering, pedals, mic or typing, action buttons that follow the screen, saved homes tab, haptics.
- **Title, intro drop, saved homes compare (Tab), demo mode (0).**
- **Offline:** with the Node server down and no internet, the game still drives, shows cards, runs missions with the local parser and opens tours in the built in viewer.
- **Production build:** `npm run demo`. The build output contains only the mock data; real city files are served from `public/data/` by the local server.

## Your car model (added Nov 14)

- The Lamborghini model you gave me is the player's car on this laptop. It is **CC BY-NC-ND 4.0** (non commercial, no modifications, credit required) and carries the Lamborghini logo, so it is kept out of git and out of mock mode, and credited on the title screen. For anything public or recorded, add `?kenney` to the address to use the free Kenney car instead.

## Aerial view and the map (added Nov 14)

- **Default view is now high and tilted** (about 50 m up, looking 50 degrees down). The Google city looks sharp from there and holds 60 fps. `C` cycles aerial, straight down, street view.
- **`M` opens the map:** a night map of the whole area made from the Vexcel photo, with glowing streets, raised buildings, every listing and the car. Click a home to get a route. `G` now switches the Google 3D city; `N` is sound.

## Visual quality pass (added Nov 14)

- **Google city looks much better from the new camera:** higher chase view (about 10 m up, 14 m back; closer when you stop), photo colors untouched, three times the tile detail at 56 to 58 fps, SMAA and light sharpening. `M` switches Google map and block city.
- **Street level is still soft.** Google's mesh is made from aerial photos: trees are lumps and walls smear when the camera is low. The higher camera hides most of it; nothing in the game can add detail Google does not have.
- **LA moved to a low rise neighborhood** around 5836 La Mirada Ave (the downtown data is kept in `public/data/la_downtown/`).
- **New car:** Kenney's CC0 sedan in red.
- **Not done:** bloom limited to markers and beams (bloom is off over the Google city instead).

## Walk mode (added Nov 14)

- **Inside a home you now walk like in a game:** WASD, click to look with the mouse, Shift runs, stairs and walls work, footsteps and a quiet room tone, a room name and size toast as you enter each room, the floor plan with your position, a vignette. `T` switches to the other viewers, `G` opens the empty rooms in the photo view, `Esc` exits (twice if the mouse is locked).
- **No textured mesh:** the MatterPak downloads are not generated for any of our scans, so the mesh's base color is baked from the panoramas instead. Near scan points it is the sharp photo (2K on the 8 demo homes); more than about 4 to 6 m from every scan point it turns soft. If you can get MatterPaks generated, see DECISIONS.md.
- **Checked:** the Playwright walk (forward 3 s, moved 4 to 6.5 m, inside the walls, on a floor) passes in three homes at 56 to 60 fps. Not checked: the mouse lock and the sounds (no pointer or ears in the test), a real phone, and 4K sky boxes.

## Real 3D city and drone view (added Nov 14)

- **Google 3D city: working since the Map Tiles API was enabled** (the car sits on the real streets, the height offset calibrates itself, about 52 to 56 fps). The notes that follow describe the earlier 403 and are kept for reference. Every request used to come back HTTP 403. In the Google Cloud console for the key's project: enable **Map Tiles API**, make sure billing is on, and if the key has API restrictions add Map Tiles API to them (referrers to allow: `http://localhost:8787/*` and `http://localhost:5173/*`). Then reload; `G` switches between the Google city and the block city. Until then the game falls back to the block city after 6 seconds by itself (that part I did see work). Expect to tune brightness and ground height once tiles load: `SHOT_TILES=1 npm run shot` writes screenshots to compare with `shots/`.
- **Drone view works:** park at either of the two Houston homes that have a drone splat (their cards show `Q Drone view`), press `Q`, `Esc` to return. About 41 to 45 fps.

## Realism pass (added Nov 14)

- **Look:** physical sky with clouds, sun shadows, sky reflections in glass and car paint, bloom and a film grade; midday, golden hour and night (`L`). Sloped roofs, five facade types, leafy trees with dappled shadows, street lamps, a new car model, 9 traffic cars. Holds 60 fps on this laptop in Houston, LA and mock.
- **Walk freely inside:** `E` now drops you into the home on foot. WASD walks, walls and furniture stop you, stairs work. It uses the scan's 3D mesh with the real photos projected on it. Houston: 40 of 47 scans; LA: 49 of 65. `python tools/build_mesh.py --city houston` rebuilds that data (inside the event window only).
- **Streets:** traced from the aerial photo at load: asphalt, double yellow or dashed lines by street width, gutters, kerbs and sidewalks, in Houston, LA and mock. Kerbs are drawn flat (no bump), and there are no crosswalks.
- **Not GTA 5:** there are no pedestrians, buildings are textured boxes with roofs, and curved roads still show the photo. Inside homes, surfaces that no scan point saw look smeared when you walk far from the scan points.

## What is mocked or limited

- **Mock mode** (`?mode=mock` or `GAME_MODE=mock`) is fully synthetic: 1,389 invented buildings, 80 invented listings, 4 drawn interiors. `docs/mock_shots/` (used by the README and for Devpost) was made this way, with the QR panel hidden.
- **Listing photos are not cached.** The photo hosts refused scripted downloads (403), and I did not try to get around that. The browser can load them directly (it did in my runs), and when it cannot, cards show a still from the home's own 3D scan and the aerial photos instead.
- **No rentals in either box** (the picked areas have homes for sale, sold homes and apartment communities). "For rent" shows 0; rent questions land on apartment communities.
- **Streets are traced from the photo, not from road data.** Straight streets on the grid get real asphalt, lane paint, kerbs and sidewalks, and routes follow them. Curved roads and short stubs keep the photo, and a long straight parking aisle is sometimes drawn as a street.
- **Houses are boxes** with photo roofs and a simple window texture. No pitched roof geometry.
- **Own viewer has 8 scan positions per home** (the Showcase has all of them). Many of these homes were scanned empty, so "See it empty" often looks the same as the furnished view.
- **LA has only 8 homes** in the box; it is mostly apartment towers. Houston is the better demo city.
- **Height fallbacks:** 157 Houston and 102 LA buildings got a default height where the surface data did not show a building.
- **Area pick deviates from the plan's formula:** apartment communities are capped at 10 per box in the score, otherwise LA would have been 66 apartment towers and one home.

## Where things are

- `DEMO_SCRIPT.md`: the 2 minute live script and which judge cares about what.
- `DEVPOST.md`, `README.md`: no schemas, field names, endpoints, counts of records or real addresses. Images from `docs/mock_shots/` only.
- `DECISIONS.md`: every call I made, by phase. "Needs real data" is at the bottom.
- `LICENSES.md`: one new dependency (`selfsigned`, MIT) for the phone's local https page. Still no GPL family packages.
- `tools/sponsor/` and `server/sponsor/`: the pipeline scripts and the search proxy. They embed sponsor field names and API details, so they are **gitignored, exist only on this laptop, and are deleted by the purge**. `tools/pick_area.py` and `tools/build_city.py` are thin wrappers around them. They are not in git history: if you need to keep the pipeline code past Sunday, ask CoStar first.
- `data/SCHEMA_NOTES.md`, `data/VEXCEL_NOTES.md`, `data/MATTERPORT_NOTES.md`, `data/MATTERPORT_SCHEMA.md`: local notes, gitignored.
- `shots/`: real data screenshots from the last run, local only. `shots/la/` and `shots/prod/` too.

## If you rebuild data

```bash
python tools/build_city.py --city houston
```

Everything is cached under `data/cache/`, so a rerun is quick. Steps can be run one at a time with `--steps elements,dedupe,ortho,terrain,listings,curb,nearby,photos,matterport`. The first run of the height step is the slow one (about 2 minutes now that duplicates are removed first). Sponsor calls refuse to run outside the event window.
