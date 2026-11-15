# Measured performance

Measured 2026-11-15 00:19 UTC by tests/sweep.spec.js, on GeForce RTX 5060 (ULTRA), 1280 x 720, real data, Vite dev server on localhost.

| What | Target | Measured |
|---|---|---|
| Cold start (page load to the world being drivable) | under 6 s | 4.0 s |
| Frame rate during the property reveal | 55+ fps | lowest 29 fps, average 49 fps |
| Maya's first words after the question (captions; model on) | under 2 s | 1.18 s, 1.28 s, 1.10 s |

Her streamed voice adds about 0.3 s before the first audio byte (measured separately against /api/maya/tts).
