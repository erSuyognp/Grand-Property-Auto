// Saved homes, kept per city in localStorage (ids only; the listing data stays in the game files).
export function initSaved(ctx) {
  const map = new Map();
  const key = () => `gpa-saved-${ctx.city}`;
  function persist() {
    try { localStorage.setItem(key(), JSON.stringify([...map.keys()])); } catch { /* private mode */ }
    ctx.emit('saved', map);
  }
  ctx.on('city', (world) => {
    map.clear();
    try {
      for (const id of JSON.parse(localStorage.getItem(key()) || '[]')) {
        const l = world.listings.find((x) => x.id === id);
        if (l) map.set(id, l);
      }
    } catch { /* ignore */ }
    ctx.emit('saved', map);
  });
  return {
    has: (id) => map.has(id),
    get size() { return map.size; },
    list: () => [...map.values()],
    add(l) { if (!map.has(l.id)) { map.set(l.id, l); persist(); } },
    remove(l) { if (map.delete(l.id)) persist(); },
    toggle(l) { if (map.has(l.id)) { map.delete(l.id); persist(); return false; } map.set(l.id, l); persist(); return true; },
    clear() { map.clear(); persist(); },
  };
}
