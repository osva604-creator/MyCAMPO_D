export function validCoordinates(gps) {
  return Boolean(gps && typeof gps.lat === 'number' && typeof gps.lng === 'number'
    && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)
    && Math.abs(gps.lat) <= 90 && Math.abs(gps.lng) <= 180);
}

export function mapsUrl(gps) {
  if (!validCoordinates(gps)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gps.lat},${gps.lng}`)}`;
}
