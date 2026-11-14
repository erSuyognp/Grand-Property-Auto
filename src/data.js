// Where game data comes from. GAME_MODE=mock (server env) or ?mode=mock (URL) loads only
// public/data/mock/: a synthetic neighborhood with zero Sponsor Data. Mock is also the
// fallback when the server is unreachable or a real city has no data yet.
let config = null;

export async function loadConfig() {
  if (config) return config;
  const urlMode = new URLSearchParams(location.search).get('mode');
  let server = {};
  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(2000) });
    if (res.ok) server = await res.json();
  } catch {
    // Offline: no server. Keep going on defaults.
  }
  const mode = urlMode === 'mock' || server.mode === 'mock' ? 'mock' : urlMode === 'real' ? 'real' : server.mode || 'real';
  config = { llm: false, matterportSdkKey: '', showcaseBase: '', ...server, mode };
  return config;
}

// Base URL for a city's files. In mock mode every city maps to the mock set.
export function dataBase(city) {
  if (!config) throw new Error('loadConfig() first');
  return config.mode === 'mock' ? '/data/mock/' : `/data/${city}/`;
}

// Fetch and parse JSON; null when the file is missing (a dev server may answer 200 with HTML).
async function tryJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Fetch a JSON data file, falling back to the mock set if the real one is missing.
export async function loadDataJson(city, file) {
  const base = dataBase(city);
  const got = await tryJson(base + file);
  if (got !== null) return got;
  if (base !== '/data/mock/') {
    console.warn(`[data] ${base}${file} missing, using mock`);
    const mock = await tryJson('/data/mock/' + file);
    if (mock !== null) return mock;
  }
  throw new Error(`[data] no ${file} for ${city}`);
}
