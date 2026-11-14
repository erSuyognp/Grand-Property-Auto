# Measured performance

Measured 2026-11-14 22:47 UTC by tests/sweep.spec.js, on GeForce RTX 5060 (ULTRA), 1280 x 720, real data, Vite dev server on localhost.

| What | Target | Measured |
|---|---|---|
| Cold start (page load to the world being drivable) | under 6 s | 5.8 s |
| Frame rate during the property reveal | 55+ fps | lowest 52 fps, average 59 fps |
| Maya's first words after the question (captions; model on) | under 2 s | 1.14 s, 1.24 s, 1.75 s |

Her streamed voice adds about 0.3 s before the first audio byte (measured separately against /api/maya/tts).
