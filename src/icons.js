// Icons from Lucide (ISC license, see LICENSES.md), inlined at build time.
const files = import.meta.glob([
  '/node_modules/lucide-static/icons/{house,shopping-cart,graduation-cap,trees,bus,dumbbell,hospital,coffee,utensils,pill,sun,zap,shield,droplets,waves,flame,activity,store,building-2,wallet,piggy-bank,info,map-pin,car,footprints,heart,scale,sparkles,mic,x,chevron-right,ruler,printer,briefcase,trophy,star,clock,trending-down,volume-2,volume-x,settings,plane,train-front,route,check,triangle-alert,inbox,user,leaf,thermometer,tree-pine,key-round,school,landmark,calculator,send,bookmark}.svg',
], { query: '?raw', import: 'default', eager: true });
const ICONS = {};
for (const [path, raw] of Object.entries(files)) {
  const name = path.split('/').pop().replace('.svg', '');
  ICONS[name] = raw.replace(/<!--[\s\S]*?-->/, '').replace(/\s+class="[^"]*"/, '').replace(/\s+width="24"\s+height="24"/, '').replace(/\s*\n\s*/g, ' ').trim();
}
export function icon(name, size = 18, cls = '') {
  const svg = ICONS[name] || ICONS.info;
  return svg.replace('<svg', `<svg class="ic ${cls}" width="${size}" height="${size}" aria-hidden="true"`);
}
// the same icon as an image (for 3D sprites), white strokes
export function iconUrl(name, color = '#ffffff') {
  const svg = (ICONS[name] || ICONS.info).replace('currentColor', color).replace('<svg', '<svg width="64" height="64"');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
export const PLACE_ICON = { supermarket: 'shopping-cart', school: 'graduation-cap', park: 'trees', transit: 'bus', gym: 'dumbbell', pharmacy: 'pill', hospital: 'hospital', cafe: 'coffee', restaurant: 'utensils' };
export const PLACE_LABEL = { supermarket: 'Supermarket', school: 'School', park: 'Park', transit: 'Transit stop', gym: 'Gym', pharmacy: 'Pharmacy', hospital: 'Hospital', cafe: 'Cafe', restaurant: 'Place to eat' };
