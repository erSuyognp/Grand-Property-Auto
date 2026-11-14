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

## Python (tools/requirements.txt)

| Package | License |
|---|---|
| requests | Apache-2.0 |
| pillow | MIT-CMU (HPND), permissive |
| shapely | BSD-3-Clause |
| pandas | BSD-3-Clause |
