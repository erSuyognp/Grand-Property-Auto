# Grand Property Auto

**Grand Property Auto** is a GTA style browser game for home buyers. You drive a real LA or Houston neighborhood built from Vexcel aerial data, pull up to homes for sale or rent from the CoStar data kit, and walk inside the real Matterport scan. Free roam by default, with voice missions ("three beds under $900k with a pool") that light up matches and guide you there. Built for the HackPrinceton Fall 2026 CoStar track ("Inside and Out: AI for the Built World"): AI is an input, not a chat window.

The full plan, phase prompts and scope guardrails live in `BUILD_PLAN.md`. Progress is tracked in `PROGRESS.md`.

## Rules

- Never ask the user questions. Make the reasonable call and log it in `DECISIONS.md`.
- Never commit `.env` or `data/raw/`.
- Commit after every phase with message `phase N: ...`.
- Every phase must keep the game runnable.
- If real data or a key is missing, use the mock data path and keep going; never block. Log it in `DECISIONS.md` under "Needs real data".
- After each phase run `npm run build` and `npm run shot`, and look at the screenshots in `shots/` before checking the phase off.
- Original art only: no GTA / Rockstar logos, fonts or artwork.
- The LLM never renders a chat window. It only produces filters and short spoken lines.
- The game never calls Vexcel live during a demo, except new semantic search words with a 3 s timeout.

## Layout

```
src/            game code, one module per system: world, car, camera, listings, hud,
                minimap, tour, missions, voice, controller, audio (+ geo, main)
server/         Node (Express + ws): /api/mission, /api/narrate, /api/vexcel/* proxy,
                websocket relay for the phone controller
tools/          Python data scripts (build_city.py, pick_area.py, check_data.py, ...)
data/raw/       user's downloads (gitignored)
data/cache/     cached API responses (gitignored)
public/data/    processed game data per city: public/data/la/, public/data/houston/
tests/          Playwright smoke tests
shots/          screenshots from `npm run shot` (gitignored)
```

## Commands

- `npm run dev`: Vite (port 5173) and the Node server (port 8787) together. Vite proxies `/api` and `/ws` to the server.
- `npm run build`: production build into `dist/`.
- `npm run shot`: Playwright opens the game, waits for the world, drives forward 3 s, saves screenshots to `shots/`.
- `npm test`: Playwright smoke tests.
