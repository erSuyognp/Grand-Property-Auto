// lat/lon <-> local meters around an area center (equirectangular; fine at 1.5 km).
const R = 6378137;
export function makeProjection([lat0, lon0]) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal(lat, lon) {
      const x = ((lon - lon0) * Math.PI / 180) * R * k;
      const z = -((lat - lat0) * Math.PI / 180) * R;
      return { x, z };
    },
    toLatLon(x, z) {
      return { lat: lat0 - (z / R) * 180 / Math.PI, lon: lon0 + (x / (R * k)) * 180 / Math.PI };
    },
  };
}
