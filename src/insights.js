// Loads the precomputed insight files (tools/enrich_city.py): one small index for every
// listing in the city and one detail file per listing, fetched when it is first needed.
import { dataBase } from './data.js';
import { costFor } from './costmath.js';

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) return null;
    return await res.json();
  } catch { return null; }
}

export function initInsights(ctx) {
  const index = new Map(), cache = new Map();
  let area = null, base = '';
  ctx.on('city', async (world) => {
    index.clear(); cache.clear();
    base = dataBase(world.city) + 'insights/';
    area = world.area.insights || null;
    const rows = await getJson(base + 'index.json');
    if (ctx.world !== world) return;
    for (const r of rows || []) index.set(r.id, r);
    ctx.emit('insights-ready', api);
  });
  const api = {
    get ready() { return index.size > 0; },
    get area() { return area; },
    get money() { return area?.money || {}; },
    row: (id) => index.get(String(id)) || null,
    rows: () => [...index.values()],
    source: (key) => area?.sources?.[key] || null,
    async get(id) {
      id = String(id);
      if (!cache.has(id)) cache.set(id, getJson(`${base}${id}.json`));
      return cache.get(id);
    },
    preload(id) { api.get(id); },
    costFor,
  };
  return api;
}
