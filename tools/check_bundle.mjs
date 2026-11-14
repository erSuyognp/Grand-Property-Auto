// Fails the build if a server-side secret ended up in the browser bundle. Two keys are meant
// for the browser and are not treated as secrets here: MATTERPORT_SDK_KEY (a domain locked
// public key) and GOOGLE_MAPS_API_KEY (Google Map Tiles, restricted by referrer). Today both
// reach the client through /api/config at run time rather than through the bundle.
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const secrets = ['VEXCEL_API_KEY', 'MATTERPORT_API_KEY', 'MATTERPORT_API_TOKEN', 'ANTHROPIC_API_KEY', 'TTS_API_KEY', 'GOOGLE_SERVER_KEY', 'ELEVENLABS_API_KEY', 'NREL_API_KEY', 'EIA_API_KEY', 'FRED_API_KEY', 'CENSUS_API_KEY', 'ORS_API_KEY']
  .map((name) => [name, process.env[name]]).filter(([, v]) => v && v.length >= 8);
const files = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'data') walk(p); } else if (/\.(js|css|html|json|map|txt)$/.test(f.name)) files.push(p);
  }
})('dist');
let bad = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, value] of secrets) {
    if (text.includes(value)) { console.error(`[check_bundle] ${name} found in ${file}`); bad++; }
  }
}
// real city data must never be copied into the build output
for (const city of ['houston', 'la']) {
  if (fs.existsSync(path.join('dist', 'data', city))) { console.error(`[check_bundle] dist/data/${city} exists: Sponsor Data in the build output`); bad++; }
}
if (bad) process.exit(1);
console.log(`[check_bundle] ${files.length} files checked, no server secrets in the bundle`);
