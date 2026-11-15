# Measured performance

Measured 2026-11-15 00:49 UTC by tests/sweep.spec.js, on GeForce RTX 5060 (ULTRA), 1280 x 720, real data, Vite dev server on localhost.

| What | Target | Measured |
|---|---|---|
| Cold start (page load to the world being drivable) | under 6 s | 5.2 s |
| Frame rate during the property reveal | 55+ fps | lowest 40 fps, average 51 fps |
| Maya's first words after the question (captions; model on) | under 2 s | 1.24 s, 1.47 s, 1.29 s |

Her streamed voice adds about 0.3 s before the first audio byte (measured separately against /api/maya/tts).
