// Maya's guided room tour (Q inside a home). She walks the home the way a good agent shows
// one: she knows its highlights beforehand, ties each room to what the buyer said they want,
// asks them to picture living there, asks one easy question per room, and lets the buyer set
// the pace: Enter for the next room, or wander off and she picks up wherever they walk.
// She ends on the strongest room, then recaps with the honest trade off and a next step.
// Every fact comes from the scan (room names and sizes), the listing's own features, or the
// insight file. Room uses are offered as possibilities ("this could be your bedroom").
import { pitch, extraFacts } from './mayaTools.js';
import { icon } from './icons.js';
import { MAYA_AVATAR } from './maya.js';

const AVATAR_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(MAYA_AVATAR.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"').replace('width="88" height="88"', 'width="256" height="256"'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const join = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const an = (n) => (/^(8|11|18|8\d)$/.test(String(n)) ? 'an' : 'a');
// what kind of stop a room is, and where it comes in the walk (agents start near the door,
// keep the bedrooms together and finish on the room with the most pull)
const KIND = [
  [/entr|foyer|lobby/i, 'entry', 0], [/living|family|great|lounge|den/i, 'living', 1], [/dining/i, 'dining', 2], [/kitchen/i, 'kitchen', 3],
  [/office|study|bonus|flex|media|game/i, 'flex', 4], [/bed/i, 'bedroom', 5], [/bath|powder/i, 'bath', 6], [/laundry|utility/i, 'laundry', 7], [/garage/i, 'garage', 8],
  [/patio|balcony|deck|terrace|yard|garden|pool|porch/i, 'outdoor', 9],
];
const SKIP = /closet|stair|hall|pantry|other|storage|corridor|undefined/i;

// Scans without room names: group the scan points that stand close together on one floor into
// "spaces", then order them as a walk from where we stand (nearest next, stairs last).
// Scan points are in model coordinates: p[0], p[1] on the floor plan, p[2] is height.
const flat = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
const sameFloor = (a, b) => (a.floor != null && b.floor != null ? a.floor === b.floor : Math.abs(a.p[2] - b.p[2]) < 1.5);
export function groupSpaces(panos, from, max = 6) {
  if (!panos.length || max < 1) return [];
  let groups = [];
  for (let r = 3.5; ; r += 1.5) {
    groups = [];
    for (const p of panos) {
      const g = groups.find((x) => sameFloor(x, p) && flat(x, p) < r);
      if (g) { g.panos.push(p); for (const k of [0, 1, 2]) g.p[k] = g.panos.reduce((t, q) => t + q.p[k], 0) / g.panos.length; } else groups.push({ p: [...p.p], floor: p.floor, panos: [p] });
    }
    if (groups.length <= max || r > 14) break;
  }
  // a small scan that falls into one group still gets a walk: its scan points one by one
  if (groups.length === 1 && panos.length > 1 && max > 1) {
    const step = Math.max(1, Math.ceil(panos.length / max));
    groups = panos.filter((_, i) => i % step === 0).map((p) => ({ p: [...p.p], floor: p.floor, panos: [p] }));
  }
  const out = [];
  let at = from || groups[0];
  const left = [...groups];
  while (left.length && out.length < max) {
    left.sort((a, b) => flat(a, at) + (sameFloor(a, at) ? 0 : 30) - flat(b, at) - (sameFloor(b, at) ? 0 : 30));
    at = left.shift();
    out.push(at);
  }
  return out;
}

export function initGuide(ctx) {
  const el = document.createElement('div');
  el.id = 'guide';
  document.body.append(el);
  const G = { target: null, idle: 0, quiet: true, nudged: false, pan: 0, showAsk: false, active: false, stops: [], i: -1, listing: null, ins: null, meta: null, focus: null, answers: {}, seen: new Set(), phase: 'off', line: '', choices: null, offered: false };
  const T = () => ctx.tour._state;
  const pub = () => { window.__gpa.guide = { active: G.active, phase: G.phase, i: G.i, n: G.stops.length, room: G.stops[G.i]?.title || null, kind: G.stops[G.i]?.kind || null, line: G.line, choices: (G.showAsk && G.choices ? G.choices : []).map((c) => c.label), stops: G.stops.map((s) => s.title), available: G.stops.length >= 1 }; };

  // ---- the route: one stop per real room, in a sensible order
  // where the route comes from: our own scan file, or (Matterport view) the scan positions the
  // Showcase reports, or (no scan at all) the listing photos
  function sourcePanos() {
    const t = T();
    if (ctx.tour.path !== 'A') return t.meta?.panos || [];
    const sw = t.sweeps || [], ids = new Set(sw.map((x) => x.id));
    const own = (t.meta?.panos || []).filter((p) => ids.has(p.id));
    return own.length ? own : sw.filter((x) => x.p);
  }
  function buildStops() {
    const t = T(), meta = t.meta;
    G.stops = [];
    if (ctx.tour.path === 'G') {
      G.stops = (t.gallery || []).slice(0, 6).map((_, i) => ({ key: `photo${i}`, name: 'photo', title: `Photo ${i + 1}`, kind: 'photo', area: 0, panos: [], gi: i, n: i }));
      return;
    }
    const panos = sourcePanos();
    if (!panos.length) return;
    const walkable = ctx.tour.path === 'W' ? new Set(ctx.tour.walk.state.panos.map((o) => o.p)) : null;
    const rooms = new Map();
    for (const p of panos) {
      const r = (meta?.rooms || []).find((x) => x.id === p.room);
      const name = p.roomLabel || r?.label;
      if (!name || SKIP.test(name) || (walkable && !walkable.has(p))) continue;
      const key = p.room || name;
      if (!rooms.has(key)) rooms.set(key, { key, name, area: r?.area > 1 ? r.area : 0, panos: [] });
      rooms.get(key).panos.push(p);
    }
    let list = [...rooms.values()].map((r) => { const k = KIND.find(([re]) => re.test(r.name)); return { ...r, kind: k ? k[1] : 'room', order: k ? k[2] : 4.5 }; });
    // number rooms that share a name ("Bedroom 1", "Bedroom 2"), biggest bedroom last of the bedrooms
    list.sort((a, b) => a.order - b.order || a.area - b.area);
    const count = {};
    for (const r of list) count[r.name] = (count[r.name] || 0) + 1;
    const nth = {};
    for (const r of list) if (count[r.name] > 1) { nth[r.name] = (nth[r.name] || 0) + 1; r.title = `${r.name} ${nth[r.name]}`; } else r.title = r.name;
    // keep it to a showing, not an inventory: at most one bathroom, laundry and garage only when there is room
    const baths = list.filter((r) => r.kind === 'bath');
    list = list.filter((r) => r.kind !== 'bath' || r === baths[baths.length - 1]);
    if (list.length > 7) list = list.filter((r) => r.kind !== 'laundry' && r.kind !== 'garage');
    if (list.length > 7) list = list.filter((r) => r.kind !== 'bath');
    G.stops = list.slice(0, 8);
    // fewer than two named rooms (most often a scan without room names): the rest of the home
    // is shown as unnamed spaces, so every home gets a showing
    if (G.stops.length < 2) {
      const used = new Set(G.stops.flatMap((x) => x.panos));
      const rest = panos.filter((p) => !used.has(p) && (!walkable || walkable.has(p)));
      const named = G.stops.length;
      const sp = groupSpaces(rest, G.stops[0]?.panos[0] || t.pano || panos[0], 6 - named);
      G.stops = [...G.stops, ...sp.map((g, n) => ({ key: `space${n}`, name: 'space', title: sp.length > 1 ? `Space ${n + 1}` : 'The space', kind: 'space', area: 0, panos: g.panos, n, alone: !named }))];
    }
  }
  const generic = (x) => x?.kind === 'space' || x?.kind === 'photo';
  // facts for stops that have no room name: only what the listing itself says
  function factLines() {
    const l = G.listing, f = l.features || {}, h = (G.ins || {}).home || {};
    const low = (a) => a.map((x) => String(x).toLowerCase());
    const pick = (sec, n) => low((f[sec] || []).filter((x) => !/\d+ (bed|full|half|sq)/i.test(x)).slice(0, n));
    const out = [];
    const add = (a, fn) => { if (a.length) out.push(fn(join(a))); };
    add(pick('Interior Spaces', 2), (x) => `Inside, the listing calls out ${x}.`);
    add(pick('Flooring', 2), (x) => `The floors are ${x}.`);
    add(h.kitchen?.length ? low(h.kitchen.slice(0, 3)) : pick('Kitchen', 3), (x) => `For the kitchen, the listing includes ${x}.`);
    add(pick('Bedrooms and Bathrooms', 2), (x) => `The listing mentions ${x}.`);
    add(low((h.laundry || []).slice(0, 2)), (x) => `Laundry in the listing: ${x}.`);
    add(low((h.parking || []).slice(0, 2)), (x) => `Parking in the listing: ${x}.`);
    if (l.beds != null && l.baths != null) out.push(`The listing counts ${l.beds === 0 ? 'a studio' : l.beds + ' bedrooms'} and ${l.baths} bathrooms in all.`);
    return out;
  }

  // ---- what she says in each room
  const prefs = () => (ctx.maya?.prefs || []).map((p) => p.text);
  function sizeText(s) { return s.area ? `about ${Math.round(s.area * 10.764)} square feet` : ''; }
  function say(s) {
    const l = G.listing, d = G.ins || {}, f = l.features || {}, h = d.home || {};
    const size = sizeText(s), first = G.i === 0;
    const pick = (sec, n = 3) => (f[sec] || []).filter((x) => !/\d+ (bed|full|half|sq)/i.test(x)).slice(0, n);
    const hello = '';
    const focus = G.focus && G.focus === s.kind ? 'You said this is the room that matters most to you, so take your time here. ' : '';
    switch (s.kind) {
      case 'entry': return { text: `${hello}This is the entry${size ? ', ' + size : ''}. ${pick('Interior Spaces', 2).length ? `Inside, the listing calls out ${join(pick('Interior Spaces', 2).map((x) => x.toLowerCase()))}.` : ''} Picture coming home through this door.`,
        ask: 'What matters most to you in a home?', choices: [['The kitchen', 'kitchen'], ['Space to work', 'flex'], ['Outdoor space', 'outdoor'], ['The bedrooms', 'bedroom']], on: (v) => { G.focus = v; return `Good to know. I'll make sure we spend time on that.`; } };
      case 'living': return { text: `${hello}${focus}This could be your living room${size ? ', ' + size : ''}. ${pick('Flooring', 2).length ? `The floors are ${join(pick('Flooring', 2).map((x) => x.toLowerCase()))}. ` : ''}Picture your sofa along that wall. Press R to measure it.`,
        ask: 'What would this room be for you?', choices: [['Movie nights', 'movies'], ['Having friends over', 'friends'], ['A quiet place to read', 'quiet']], on: (v) => (v === 'friends' && d.activity?.shopsWalk ? `Then you'll like this: ${d.activity.shopsWalk} shops and places to eat are within a 10 minute walk for when the evening moves out.` : v === 'quiet' && d.noise?.highway ? `For quiet, a fact: the nearest highway is ${d.noise.highway.distM} meters away.` : 'It has the wall space for it. Measure it with R if you want to be sure.') };
      case 'dining': return { text: `${hello}The dining room${size ? ', ' + size : ''}. Picture dinner with friends here, right off the kitchen.` };
      case 'kitchen': {
        const k = (h.kitchen?.length ? h.kitchen : pick('Kitchen', 4)).slice(0, 4);
        const sup = d.places?.supermarket?.[0];
        return { text: `${hello}${focus}This is the kitchen${size ? ', ' + size : ''}. ${k.length ? `The listing includes ${join(k.map((x) => x.toLowerCase()))}. ` : ''}Picture a weeknight dinner here.`,
          ask: 'Do you cook most nights?', choices: [['Most nights', 'cook'], ['Sometimes', 'some'], ['Mostly takeout', 'takeout']], on: (v) => (v === 'takeout' ? (d.activity?.shopsWalk ? `Then the street matters more than the stove: ${d.activity.shopsWalk} shops and places to eat within a 10 minute walk.` : 'Then the stove gets an easy life.') : sup ? `Then this helps: ${sup.name} is ${sup.walkMin <= 15 ? `${an(sup.walkMin)} ${sup.walkMin} minute walk` : `about ${an(sup.driveMin)} ${sup.driveMin} minute drive`} for groceries.` : 'Then this is where you will spend your evenings.') };
      }
      case 'flex': return { text: `${hello}${focus}The listing calls this ${/^[aeiou]/i.test(s.name) ? 'an' : 'a'} ${s.name.toLowerCase()}${size ? ', ' + size : ''}. This could be your office, a guest room, or a place for hobbies.`,
        ask: 'Do you work from home?', choices: [['Most days', 'wfh'], ['Sometimes', 'hybrid'], ['No', 'commute']], on: (v) => (v === 'commute' && d.drive?.downtown ? `Then the commute counts: ${d.drive.downtown.name} is about ${an(d.drive.downtown.min)} ${d.drive.downtown.min} minute drive, as an estimate.` : `Then picture your desk here. ${d.places?.cafe?.[0] ? `And for a change of scene, ${d.places.cafe[0].name} is ${an(d.places.cafe[0].walkMin)} ${d.places.cafe[0].walkMin} minute walk.` : ''}`) };
      case 'bedroom': {
        const bed = s.area >= 13 ? 'a king bed fits with space to walk around it' : s.area >= 9.5 ? 'a queen bed fits comfortably' : s.area ? 'a full bed fits, or it makes a good office' : '';
        return { text: `${hello}${focus}This could be your bedroom. ${size ? `At ${size}, ${bed}. ` : ''}${pick('Bedrooms and Bathrooms', 2).length ? `The listing mentions ${join(pick('Bedrooms and Bathrooms', 2).map((x) => x.toLowerCase()))}. ` : ''}Picture waking up here.`,
          ask: 'What would you use this room for?', choices: [['My bedroom', 'mine'], ['A guest room', 'guest'], ['A home office', 'office']], on: (v) => (v === 'office' ? 'A door you can close and a window: that works as an office.' : v === 'guest' ? 'Guests would have their own space here.' : `Then here's a fact for the mornings: ${ctx.buyer?.sunLine ? ctx.buyer.sunLine(l, 7).split('.')[0] + '.' : 'check the light with the sun slider on the home panel.'}`) };
      }
      case 'bath': return { text: `${hello}A bathroom${size ? ', ' + size : ''}. The listing counts ${l.baths ?? 'the'} bathrooms in all.` };
      case 'laundry': return { text: `${hello}Laundry is here${(h.laundry || []).length ? `: ${join(h.laundry.slice(0, 3).map((x) => x.toLowerCase()))}` : ''}. No trips to a laundromat.` };
      case 'garage': return { text: `${hello}The garage${size ? ', ' + size : ''}. ${(h.parking || []).length ? `Parking in the listing: ${join(h.parking.slice(0, 2).map((x) => x.toLowerCase()))}.` : ''}` };
      case 'outdoor': {
        const park = d.places?.park?.[0], a = d.aerial || {};
        return { text: `${hello}${focus}Step outside: the ${s.name.toLowerCase()}${size ? ', ' + size : ''}. ${a.pool ? 'There is a pool, seen from the air. ' : ''}${a.treeCoverPct >= 10 ? `Tree cover on the lot is ${a.treeCoverPct} percent. ` : ''}${park ? `And ${park.name} is ${an(park.walkMin)} ${park.walkMin} minute walk when you want more green.` : ''}`,
          ask: 'What would you do out here?', choices: [['Morning coffee', 7.5], ['Evening grill', 18], ['Grow plants', 13]], on: (v) => (ctx.buyer?.sunLine ? ctx.buyer.sunLine(l, v).split(' Sunrise')[0] : 'It gets you outside without leaving home.') };
      }
      case 'space': case 'photo': {
        const facts = factLines(), fact = s.n < facts.length ? ' ' + facts[s.n] : '';
        const photo = s.kind === 'photo';
        const open = photo ? (s.n === 0 ? `There is no 3D scan to walk through here, so I'll take you through the listing photos.` : ['Here is another view.', 'One more photo from the listing.'][s.n % 2])
          : first ? `We'll start here.${s.alone ? ` This scan has no room names, so I'll tell you what the listing says as we go.` : ''}` : ['Have a look around this part of the home.', 'Take in this space.'][s.n % 2];
        const tape = !photo && s.n === 1 && ctx.tour.path === 'W' ? ' Press R to measure anything.' : '';
        const m = { text: `${open}${fact}${tape}` };
        if (first) {
          const sup = d.places?.supermarket?.[0], park = d.places?.park?.[0], cafe = d.places?.cafe?.[0];
          m.ask = 'What matters most to you in a home?';
          m.choices = [['The kitchen', 'kitchen'], ['Space to work', 'flex'], ['Outdoor space', 'outdoor'], ['The bedrooms', 'bedroom']];
          m.on = (v) => (v === 'kitchen' && sup ? `Good to know. For groceries, ${sup.name} is ${sup.walkMin <= 15 ? `${an(sup.walkMin)} ${sup.walkMin} minute walk` : `about ${an(sup.driveMin)} ${sup.driveMin} minute drive`}.`
            : v === 'flex' && cafe ? `Good to know. For a change of scene, ${cafe.name} is ${an(cafe.walkMin)} ${cafe.walkMin} minute walk.`
              : v === 'outdoor' && park ? `Good to know. ${park.name} is ${an(park.walkMin)} ${park.walkMin} minute walk.`
                : v === 'bedroom' && l.beds ? `Good to know. The listing counts ${l.beds} bedrooms.` : 'Good to know.');
        }
        return m;
      }
      default: return { text: `${hello}This is the ${s.name.toLowerCase()}${size ? ', ' + size : ''}.` };
    }
  }
  function recap() {
    const l = G.listing, d = G.ins, row = ctx.insights.row(l.id);
    const p = d ? pitch(d, row) : { points: [], tradeoffs: [] };
    const pts = p.points.slice(0, 2).map((x) => x.text);
    const cost = d?.cost ? ` Owning it is an estimated ${usd(d.cost.total)} a month.` : row?.rent ? ` Rent starts at ${usd(row.rent)} a month.` : '';
    return { text: `That's the home. ${pts.length ? `What stands out: ${join(pts)}.` : ''}${p.tradeoffs[0] ? ` The trade off: ${p.tradeoffs[0].text}.` : ''}${cost}`,
      ask: 'How does this one feel?', choices: [['I love it', 'love'], ['Show me the costs', 'costs'], ['Find me a better fit', 'better']], final: true };
  }

  // the next owning fact she has not said yet in this showing (insurance, HOA, amenities, ...)
  const nextFact = () => extraFacts(G.ins)[G.factI || 0] || null;
  // ---- what she says on the way to a room, like an agent walking a step ahead of you
  function hello() {
    const l = G.listing, ms = ctx.maya?.state;
    // she says who she is once per game, not at every door
    const open = ms && ms.introduced ? 'Welcome in.' : "Welcome in, I'm Maya, your real estate AI agent.";
    if (ms) ms.introduced = true;
    // the best thing about this home first, from its own data; a listing highlight when there is none
    const top = G.ins ? pitch(G.ins, ctx.insights.row(l.id)).points[0] : null;
    const hl = top ? null : (l.highlights || []).find((x) => x && x.length < 40);
    if (hl) G.hl = 1;
    const best = top ? ` Here's my favorite thing about this one: ${top.text}.` : hl ? ` The listing's headline here is ${hl.toLowerCase()}.` : '';
    const n = (v, w) => `${v} ${w}${Number(v) === 1 ? '' : 's'}`;
    const rooms = [l.beds != null ? n(l.beds, 'bedroom') : null, l.baths != null ? n(l.baths, 'bath') : null].filter(Boolean);
    const facts = [rooms.length ? `It has ${rooms.join(' and ')}` : null, l.sqft ? `${rooms.length ? '' : 'It has '}${Number(l.sqft).toLocaleString('en-US')} square feet` : null].filter(Boolean).join(', ');
    const built = l.yearBuilt ? (facts ? `, and it was built in ${l.yearBuilt}` : `It was built in ${l.yearBuilt}`) : '';
    return `${open}${best}${facts || built ? ` ${facts}${built}.` : ''} Walk with me, I'll show you around. Stop me any time.`;
  }
  function onTheWay(s, from) {
    const fl = (x) => x?.panos?.[0]?.floor;
    const stairs = from && fl(from) != null && fl(s) != null && fl(from) !== fl(s) ? (fl(s) > fl(from) ? ' It is upstairs.' : ' It is downstairs.') : '';
    if (s.kind === 'photo') return 'Next photo.';
    if (s.kind === 'space') return ['Come this way.', 'There is more over here.', 'Let us keep going.'][s.n % 3] + stairs;
    const last = G.stops.indexOf(s) === G.stops.length - 1 && G.stops.length > 2;
    const t = { entry: 'Let us start at the front door.', living: 'Come on through to the living room.', dining: 'The dining room is just through here.', kitchen: 'Follow me into the kitchen.', flex: `This way. I want to show you the ${s.name.toLowerCase()}.`,
      bedroom: /2|3|4/.test(s.title) ? 'One more bedroom, just over here.' : 'The bedrooms are this way.', bath: 'A quick look at the bathroom.', laundry: 'Laundry is right here.', garage: 'Let me show you the garage.', outdoor: 'Now step outside with me.' }[s.kind] || `Next, the ${s.name.toLowerCase()}.`;
    return (last ? 'I saved this one for last. ' : '') + t + stairs;
  }

  // ---- the card: Maya's face, the room, her words, the buyer's choices
  function render() {
    const s = G.stops[G.i];
    const title = G.phase === 'offer' || G.phase === 'hello' ? 'Maya' : G.phase === 'recap' ? 'Before you go' : G.phase === 'walking' ? (G.target?.kind === 'photo' ? 'Next photo' : G.target?.kind === 'space' ? 'This way' : `To the ${(G.target?.title || '').toLowerCase()}`) : s?.title || 'Maya';
    const sub = G.phase === 'room' ? `${s?.kind === 'photo' ? 'Photo' : s?.kind === 'space' ? 'Stop' : 'Room'} ${G.i + 1} of ${G.stops.length}${s?.area ? ` · ${Math.round(s.area * 10.764)} sq ft` : ''}` : G.phase === 'walking' ? 'Walking with Maya' : 'Your agent';
    el.innerHTML = `<div class="gcard${G.phase === 'walking' || G.phase === 'hello' ? ' slim' : ''}" role="dialog" aria-label="Guided tour with Maya">
      <div class="ghead"><span class="gava">${MAYA_AVATAR}</span><div><b>${esc(title)}</b><small>${esc(sub)}</small></div>
        ${G.active ? `<span class="gdots">${G.stops.map((x, k) => `<i class="${G.seen.has(x.key) && k !== G.i ? 'done' : k === G.i && G.phase !== 'walking' ? 'on' : ''}"></i>`).join('')}</span>` : ''}</div>
      <p class="gline" aria-live="polite">${esc(G.line)}</p>
      ${G.ask && G.showAsk ? `<p class="gask">${esc(G.ask)}</p>` : ''}
      ${G.choices && G.showAsk ? `<div class="gchoices">${G.choices.map((c, i) => `<button data-c="${i}"><kbd>${i + 1}</kbd>${esc(c.label)}</button>`).join('')}</div>` : ''}
      <div class="gkeys">${G.phase === 'offer' ? `<button class="act primary" data-a="start"><kbd>Q</kbd>Show me around</button><button class="act ghost" data-a="hide">Not now</button>`
        : G.phase === 'recap' ? `<button class="act ghost" data-a="end"><kbd>Q</kbd>Done</button>`
          : G.phase === 'room' ? `<button class="act primary" data-a="next"><kbd>Enter</kbd>${[...G.stops].every((x) => G.seen.has(x.key)) ? 'Wrap up' : generic(s) ? 'Next' : 'Next room'}</button><span class="ghint">or look around, I'll wait${ctx.mayaLive?.available() ? '. Press V to ask me anything' : ''}</span><button class="act ghost" data-a="end"><kbd>Q</kbd>End tour</button>`
            : `<span class="ghint">Maya is walking you there</span><button class="act ghost" data-a="end"><kbd>Q</kbd>End tour</button>`}</div></div>`;
    el.classList.add('show');
    for (const b of el.querySelectorAll('[data-c]')) b.addEventListener('click', () => answer(Number(b.dataset.c)));
    el.querySelector('[data-a="start"]')?.addEventListener('click', () => start());
    el.querySelector('[data-a="hide"]')?.addEventListener('click', () => hide());
    el.querySelector('[data-a="next"]')?.addEventListener('click', () => next());
    el.querySelector('[data-a="end"]')?.addEventListener('click', () => end());
    pub();
  }
  function speak(text) { G.line = text; G.quiet = false; G.idle = 0; G.nudged = false; ctx.maya?.say(text, { caption: false, force: true }); ctx.mayaLive?.note(400); }
  function hide() { el.classList.remove('show'); G.phase = G.active ? G.phase : 'off'; pub(); }
  // her mouth moves with her voice
  ctx.on('post', () => { if (!el.classList.contains('show')) return; const m = el.querySelector('.gava .mouth'); if (m) { const v = ctx.maya?.level?.() || 0; m.setAttribute('ry', (2 + v * 8).toFixed(1)); } });

  const rep = (s) => { // the scan point nearest the middle of the room
    const ps = s.panos;
    if (!ps.length) return null;
    const cx = ps.reduce((t, p) => t + p.p[0], 0) / ps.length, cz = ps.reduce((t, p) => t + p.p[2], 0) / ps.length;
    return [...ps].sort((a, b) => Math.hypot(a.p[0] - cx, a.p[2] - cz) - Math.hypot(b.p[0] - cx, b.p[2] - cz))[0];
  };
  let walkTimer = 0;
  // walk there together: she talks on the way, the room is presented on arrival
  function lead(i) {
    const s = G.stops[i], from = G.stops[G.i];
    clearTimeout(walkTimer);
    const here = s.kind === 'photo' ? T().gi === s.gi : T().pano && s.panos.includes(T().pano);
    if (here && !(ctx.tour.path === 'W' && ctx.tour.walk.moving)) return present(i);
    G.target = s; G.targetIndex = i; G.phase = 'walking'; G.ask = null; G.choices = null; G.walkT = 0; G.filler = false;
    speak(onTheWay(s, from));
    render();
    const p = rep(s);
    G.targetPano = p ? p.id : s.key;
    if (s.kind === 'photo') { ctx.tour.galleryShow(s.gi); walkTimer = setTimeout(() => arrive(s.key), 1300); return; }
    // Matterport view: the Showcase flies there and reports the scan position it lands on
    if (ctx.tour.path === 'A') { ctx.tour.goTo(p); walkTimer = setTimeout(() => arrive(p.id), 8000); return; }
    if (ctx.tour.path === 'W') ctx.tour.walk.goTo(p); else { ctx.tour._show(p); walkTimer = setTimeout(() => arrive(p.id), 1600); return; }
    walkTimer = setTimeout(() => arrive(p.id), 45000); // never stuck on the way
  }
  function arrive(id) {
    if (!G.active || G.phase !== 'walking' || id !== G.targetPano) return;
    clearTimeout(walkTimer);
    present(G.targetIndex);
  }
  ctx.on('walk-arrive', (id) => arrive(id));
  function present(i) {
    G.i = i; G.phase = 'room'; G.target = null; G.pan = 0;
    const s = G.stops[i];
    G.seen.add(s.key);
    const m = say(s);
    // a room with no question for the buyer carries one owning fact instead (insurance, HOA, amenities, ...)
    const fact = !m.ask && i > 0 ? nextFact() : null;
    if (fact) { G.factI++; m.text = `${m.text.trim()} While we are here: ${fact.text}`; }
    G.ask = m.ask || null;
    G.choices = m.choices ? m.choices.map(([label, value]) => ({ label, value })) : null;
    G.on = m.on || null;
    G.showAsk = false; // the question appears when she has finished the sentence before it
    speak(m.ask ? `${m.text} ${m.ask}` : m.text);
    G.line = m.text;
    render();
    ctx.audio.blip(880, 0.06);
    // have the sharp photo of the next room ready before we walk there
    const nx = G.stops.find((x) => !G.seen.has(x.key));
    if (nx && nx.panos.length && ctx.tour.path === 'W') ctx.tour.walk.preload(rep(nx));
  }
  async function start() {
    if (!ctx.tour.active || G.stops.length < 1 || G.active) return false;
    G.active = true; G.seen = new Set(); G.answers = {}; G.i = -1;
    G.ins = G.ins || (await ctx.insights.get(G.listing.id));
    const at = T().pano?.p;
    if (at) {
      const d = (s) => Math.min(...s.panos.map((p) => Math.hypot(p.p[0] - at[0], p.p[2] - at[2]) + Math.abs(p.p[1] - at[1]) * 4));
      const main = G.stops.filter((s) => ['entry', 'living', 'dining', 'kitchen'].includes(s.kind));
      const near = main.sort((a, b) => d(a) - d(b))[0];
      if (near && near !== G.stops[0] && d(G.stops[0]) - d(near) > 4) { G.stops = [near, ...G.stops.filter((s) => s !== near)]; }
    }
    if (ctx.tour.path === 'W') ctx.tour.walk.setLead(AVATAR_URL);
    G.hl = 0; G.walkT = 0; G.filler = false; G.factI = 0; G.walks = 0;
    G.phase = 'hello'; G.ask = null; G.choices = null;
    speak(hello());
    render();
    if (ctx.tour.path === 'W' && G.stops[0].panos.length) ctx.tour.walk.preload(rep(G.stops[0]));
    return true;
  }
  function next() {
    if (!G.active || G.phase === 'walking') return;
    const order = [...G.stops.keys()].filter((k) => !G.seen.has(G.stops[k].key));
    if (!order.length) return wrapUp();
    lead(order[0]);
  }
  function wrapUp() {
    G.phase = 'recap';
    const m = recap();
    G.ask = m.ask; G.choices = m.choices.map(([label, value]) => ({ label, value })); G.on = null; G.showAsk = false;
    speak(`${m.text} ${m.ask}`);
    G.line = m.text;
    render();
  }
  function answer(i) {
    const c = G.showAsk ? G.choices?.[i] : null;
    if (!c) return;
    ctx.audio.click?.();
    if (G.phase === 'recap') {
      const l = G.listing;
      if (c.value === 'love') { ctx.saved.add(l); ctx.hud.toast('Saved to your list'); G.ask = null; G.choices = null; speak('Saved. When you are ready, compare it with your other favorites on Tab.'); render(); return; }
      end(true);
      ctx.tour.exit().then(() => { if (c.value === 'costs') ctx.reveal.select(l, { instant: true }).then(() => setTimeout(() => ctx.panel.flash('cost'), 600)); else ctx.reveal.select(l, { instant: true }).then(() => ctx.maya.hear('Show me better options')); });
      return;
    }
    const s = G.stops[G.i];
    G.answers[s.kind] = c.value;
    if (generic(s)) ctx.maya?.remember?.(`matters most: ${c.label.toLowerCase()}`); else if (s.kind !== 'entry') ctx.maya?.remember?.(`${s.name.toLowerCase()}: ${c.label.toLowerCase()}`);
    const reply = G.on ? G.on(c.value) : '';
    G.ask = null; G.choices = null;
    speak(reply || 'Got it.');
    render();
  }
  function end(quiet) {
    if (!G.active && G.phase === 'off') return;
    clearTimeout(walkTimer);
    G.active = false; G.phase = 'off'; G.i = -1; G.line = ''; G.target = null;
    if (ctx.tour.active && ctx.tour.path === 'W') ctx.tour.walk.setLead(null);
    el.classList.remove('show');
    if (!quiet) ctx.maya?.interrupt();
    pub();
  }

  // ---- pacing: she finishes a sentence, then gives the buyer time, then moves on by herself
  ctx.on('maya-quiet', () => {
    if (!G.active) return;
    G.quiet = true; G.idle = 0;
    if (G.phase === 'hello') return lead(0);
    if ((G.phase === 'room' || G.phase === 'recap') && G.ask && !G.showAsk) { G.showAsk = true; render(); }
  });
  const touch = () => { G.idle = 0; };
  addEventListener('pointerdown', touch);
  ctx.on('key', touch);

  // ---- when it shows up
  let lastMeta = null, offerTimer = 0, ledKey = '';
  const leads = () => (ctx.params.get('guide') || ctx.settings?.tourGuide || 'auto') !== 'ask';
  ctx.on('tour-enter', (l) => { G.listing = l; G.ins = null; G.offered = false; G.focus = null; lastMeta = null; ledKey = ''; ctx.insights.get(l.id).then((d) => { if (G.listing === l) G.ins = d; }); });
  ctx.on('tour-exit', () => { clearTimeout(offerTimer); end(true); G.stops = []; el.classList.remove('show'); pub(); });
  ctx.on('update', (dt) => {
    if (!ctx.tour.active) return;
    const t = T();
    // a home (or another space of an apartment community) finished loading: plan the route.
    // Maya then starts showing it by herself, the way an agent meets you at the door.
    // The route is planned from whatever this view has: our scan file (walking and photo spot
    // views), the Showcase's scan positions (Matterport view), or the listing photos.
    const path = ctx.tour.path;
    const src = path === 'B' || (path === 'W' && ctx.tour.walk.ready) ? t.meta
      : path === 'A' && t.sdk && t.sweeps?.some((x) => x.p) ? t.sweeps
        : path === 'G' && t.gallery?.length ? t.gallery : null;
    if (src && src !== lastMeta) {
      lastMeta = src;
      end(true);
      buildStops();
      pub();
      // she starts by herself once per space; after switching views (T) it is Q to start again
      const key = `${t.listing?.id}|${t.modelIndex}`;
      if (G.stops.length >= 1 && key !== ledKey && !ctx.demo?.running && !ctx.params.has('noguide')) {
        ledKey = key;
        clearTimeout(offerTimer);
        offerTimer = setTimeout(() => {
          if (!ctx.tour.active || G.active) return;
          if (leads()) { start(); return; }
          G.phase = 'offer'; G.ask = null; G.choices = null;
          G.line = `Want me to show you around? ${G.stops.length} ${G.stops.some(generic) ? 'stops' : 'rooms'}, a few minutes, and you can wander off any time.`;
          if (!G.offered) { G.offered = true; ctx.maya?.say('Want me to show you around?', { caption: false, force: true }); }
          render();
        }, 1500);
      }
    }
    if (!G.active) return;
    const W = ctx.tour.path === 'W';
    // while she talks about a room the view turns slowly, so the whole room is seen
    if (G.phase === 'room' && W && !ctx.tour.walk.moving && G.pan < 1.9 && !(ctx.settings?.reducedMotion)) { const d = dt * 0.11; G.pan += d; ctx.tour.walk.look(d, 0); }
    // the buyer leads: when they walk into a room on the route that she has not shown, she picks up there
    if (G.phase === 'room' && t.pano && !(W && ctx.tour.walk.led)) {
      const k = G.stops.findIndex((s) => s.panos.includes(t.pano));
      if (k >= 0 && k !== G.i && !G.seen.has(G.stops[k].key)) present(k);
    }
    if (G.phase === 'walking') {
      G.walkT += dt;
      const hl = (G.listing.highlights || []).filter((x) => x && x.length < 40);
      // on the way she covers the owning side too (insurance, HOA, amenities, tax, energy),
      // taking turns with what the listing points out
      const fact = G.walks % 2 === 0 || hl.length <= G.hl ? nextFact() : null;
      if (G.quiet && !G.filler && G.walkT > 2.2 && (fact || hl.length > G.hl)) {
        G.filler = true; G.walks++;
        if (fact) { G.factI++; speak(`While we walk: ${fact.text}`); }
        else {
          const a = hl[G.hl++], b = hl[G.hl] && G.hl % 2 ? hl[G.hl++] : null;
          speak(`While we walk: the listing points out ${a.toLowerCase()}${b ? ` and ${b.toLowerCase()}` : ''}.`);
        }
        render();
      }
    }
    // quiet for a while: a gentle word, then on to the next room
    if (G.quiet && G.phase === 'room') {
      G.idle += dt;
      const asking = !!(G.choices && G.showAsk);
      // a buyer who stays quiet is not kept waiting: a short pause on a question, then she moves on
      if (asking && !G.nudged && G.idle > 6) { G.nudged = true; G.ask = null; G.choices = null; speak('No rush. Take a look around.'); render(); } else if (!asking && G.idle > 3) { G.idle = 0; next(); }
    }
  });
  ctx.on('key', (code) => {
    if (!ctx.tour.active) return;
    if (code === 'KeyQ') { if (G.active) end(); else if (G.stops.length >= 1) start(); }
    else if (!G.active) return;
    else if (code === 'Enter') { if (G.phase === 'recap') end(); else if (G.phase === 'hello') lead(0); else next(); }
    else { const m = /^Digit([1-4])$/.exec(code); if (m) answer(Number(m[1]) - 1); }
  });
  pub();
  return {
    start, next, end, answer,
    get active() { return G.active; },
    get stops() { return G.stops; },
    get asked() { return G.phase === 'room' ? !!G.ask : null; },
    brief: () => (G.active ? `Guided tour in progress: ${G.phase === 'recap' ? 'wrapping up' : `at: ${G.stops[G.i]?.title}`}. You just said to the player: "${G.line}"${G.ask ? ` and asked: "${G.ask}"` : ''}. Their answers so far: ${JSON.stringify(G.answers)}. If they speak, answer briefly and stay on this room.` : ''),
  };
}
