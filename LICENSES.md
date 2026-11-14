# Dependency licenses

Rule 6 of the data agreement: only permissive licenses (MIT, BSD, Apache 2.0, ISC). Check before adding anything and log it here.

## npm (direct)

| Package | Version | License | Use |
|---|---|---|---|
| three | 0.187.0 | MIT | 3D rendering |
| express | 5.3.0 | MIT | server |
| ws | 8.23.0 | MIT | phone controller websocket |
| dotenv | 18.0.10 | BSD-2-Clause | .env loading |
| qrcode | 1.5.4 | MIT | phone pairing QR code |
| @anthropic-ai/sdk | 1.8.0 | Apache-2.0 | mission parser / narration (only when LLM_ENABLED=true) |
| selfsigned | 5.5.0 | MIT | self-signed certificate for the phone controller's local https page |
| vite (dev) | 8.3.8 | MIT | dev server and bundler |
| concurrently (dev) | 10.0.7 | MIT | runs vite + server together |
| playwright, @playwright/test (dev) | 1.65.1 | Apache-2.0 | screenshots and smoke tests |

## npm (transitive, scanned 2026-11-14)

All 142 installed packages: 113 MIT, 15 ISC, 7 Apache-2.0, 3 BSD (2- and 3-Clause), 1 0BSD, plus:

| Package | License | Note |
|---|---|---|
| fast-sha256 | Unlicense | Public domain dedication, permissive. Pulled in by @anthropic-ai/sdk |
| lightningcss (+ win32 binary) | MPL-2.0 | Weak, file level copyleft, not GPL/LGPL/AGPL. Build time only (Vite CSS), nothing from it ships in the bundle, and we don't modify it. Logged in DECISIONS.md |

No GPL, LGPL or AGPL packages.

Added for the realism pass: `three-mesh-bvh` 0.9.18, MIT (ray casts against interior meshes for walking and collisions). The sky, post-processing and geometry helpers come from `three/addons`, which ship inside `three` (MIT).

Added for the real 3D city: `3d-tiles-renderer` 0.5.4 (NASA-AMMOS 3DTilesRendererJS), Apache-2.0, and `@mkkellogg/gaussian-splats-3d` 0.4.7, MIT (drone view). The Draco and Basis decoder files served from `/libs/` are copied out of the `three` package at build time (Draco: Apache-2.0, Basis Universal: Apache-2.0). Google Photorealistic 3D Tiles are a paid Google Maps Platform service under Google's terms, not an open source dependency; the attribution and logo are shown whenever they are on screen.

Added for walk mode (dev only, used by the local MatterPak converter): `obj2gltf` 3.2.0 and `gltf-pipeline` 4.3.1, both Cesium, Apache-2.0. They are installed and wired into `tools/sponsor/build_matterpak.py`, but have not run on real data yet because no MatterPak could be downloaded (see DECISIONS.md).

Car models: **Kenney Car Kit 3.1** (www.kenney.nl), Creative Commons Zero (CC0), in `public/models/kenney/` with its `License.txt`. Four models are used (sedan-sports for the player; sedan, suv and hatchback-sports for traffic). CC0 is public domain dedication, more permissive than MIT.

**Local only, not in the repo, NOT permissively licensed:** `public/models/local/car.glb` is "Lamborghini Aventador LP700-4" by Gonzalit (sketchfab.com/Gonzalit), **CC BY-NC-ND 4.0**: attribution required, non commercial use only, no modified versions. It is gitignored, loaded only if present, never used in mock mode, used unmodified (fitted and oriented at run time only), and credited on the title screen. It also carries Lamborghini's name and logo. Do not ship it, do not use it in public or commercial material, and delete it with the rest after the event.

## Python (tools/requirements.txt)

| Package | License |
|---|---|
| requests | Apache-2.0 |
| pillow | MIT-CMU (HPND), permissive |
| shapely | BSD-3-Clause |
| pandas | BSD-3-Clause |
