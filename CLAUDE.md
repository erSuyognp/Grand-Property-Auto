# Grand Property Auto

**Grand Property Auto** is a GTA style browser game for home buyers. You drive a real LA or Houston neighborhood built from Vexcel aerial data, pull up to homes for sale or rent from the CoStar data kit, and walk inside the real Matterport scan. Free roam by default, with voice missions ("three beds under $900k with a pool") that light up matches and guide you there.

The full plan, phase prompts and scope guardrails live in `BUILD_PLAN.md`. Progress is tracked in `PROGRESS.md`. Decisions are logged in `DECISIONS.md`.

## Data agreement rules (OVERRIDE EVERYTHING ELSE)

These come from the CoStar Sponsor Data agreement (`data/raw/terms.txt`) and take priority over every other instruction in this file, in BUILD_PLAN.md, or in any prompt.

1. **Use the data only between Fri Nov 13 4:30 PM and Sun Nov 15 4:00 PM EST.** No API calls outside that window.
2. **The data never leaves this laptop.** No GitHub push of any data, cache, sample, screenshot or schema note. No cloud hosting (no Vercel, no Cloudflare Pages). No tunnels (no ngrok); the phone controller works over the same wifi or the laptop's hotspot.
3. **Schemas, non public API details and credentials are confidential too.** `data/SCHEMA_NOTES.md`, `data/VEXCEL_NOTES.md`, `data/MATTERPORT_SCHEMA.md` and `data/samples/` stay local and gitignored. The repo stays **private**.
4. **Nothing confidential in public demos.** Anything public (Devpost screenshots, a public video) is made in **mock mode** with the synthetic neighborhood. Real data is shown only live to the judges.
5. **Delete everything right after the event.** That covers every copy, extract, cache and derivative: `data/`, `public/data/`, `shots/`, browser caches, and the Claude Code session logs for this project. `tools/purge.sh` does it.
6. **Only permissive open source** (MIT, BSD, Apache 2.0, ISC). No GPL, LGPL or AGPL dependencies without CoStar's written OK.
7. **No third party sharing.** Whether sending data to the Anthropic API (Claude Code itself, and the in game mission parser and narration) counts as sharing is **unconfirmed**. Until CoStar confirms in writing it's fine, `LLM_ENABLED=false` by default: the game uses the local keyword parser and template narration, and the server sends only the spoken words and a few listing numbers (no addresses, no agent data) when it is turned on.

## Working rules

- Never ask the user questions. Make the reasonable call and log it in `DECISIONS.md`.
- Never add a git remote and never push.
- Never commit `.env` or anything that holds Sponsor Data (see `.gitignore`).
- Commit after every phase with message `phase N: ...`.
- Before adding any npm or pip dependency, check its license: only MIT, BSD, Apache 2.0 or ISC. Log every dependency and its license in `LICENSES.md`.
- Every phase must keep the game runnable.
- If real data or a key is missing, use the mock data path and keep going; never block. Log it in `DECISIONS.md` under "Needs real data".
- After each phase run `npm run build` and `npm run shot`, and look at the screenshots in `shots/` before checking the phase off.
- Every Vexcel and Matterport call goes through the data window guard (`server/dataWindow.js`, `tools/data_window.py`).
- `GAME_MODE=mock` loads only `public/data/mock/` (synthetic, zero Sponsor Data). It is the only mode allowed for anything public.
- Original art only: no GTA / Rockstar logos, fonts or artwork.
- The LLM never renders a chat window. It only produces filters and short spoken lines.
- The game never calls Vexcel live during a demo, except new semantic search words with a short timeout.

## Layout

```
src/            game code, one module per system: world, car, camera, listings, hud,
                minimap, tour, missions, voice, controller, audio (+ geo, data, main)
server/         Node (Express + ws): /api/config, /api/mission, /api/narrate,
                /api/vexcel/* proxy, websocket relay for the phone controller
tools/          Python data scripts (build_city.py, pick_area.py, make_mock_data.py, purge.sh, ...)
data/           everything here is gitignored: raw/ downloads, cache/, samples/, *_NOTES.md
public/data/    processed game data per city: la/, houston/ (gitignored), mock/ (committed, synthetic)
tests/          Playwright smoke tests
shots/          screenshots from `npm run shot` (gitignored)
```

## Commands

- `npm run dev`: Vite (port 5173) and the Node server (port 8787) together. Vite proxies `/api` and `/ws` to the server.
- `npm run build`: production build into `dist/`.
- `npm run shot`: Playwright opens the game, waits for the world, drives forward 3 s, saves screenshots to `shots/`.
- `npm test`: Playwright smoke tests.
- `bash tools/purge.sh`: deletes all Sponsor Data and derivatives (asks first).
