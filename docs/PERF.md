# Measured performance

Measured 2026-11-14 23:40 UTC by tests/sweep.spec.js, on GeForce RTX 5060 (ULTRA), 1280 x 720, real data, Vite dev server on localhost.

| What | Target | Measured |
|---|---|---|
| Cold start (page load to the world being drivable) | under 6 s | 3.9 s |
| Frame rate during the property reveal | 55+ fps | lowest 35 fps, average 51 fps |
| Maya's first words after the question (captions; model on) | under 2 s | 1.18 s, 1.34 s, 1.25 s |

Her streamed voice adds about 0.3 s before the first audio byte (measured separately against /api/maya/tts).
