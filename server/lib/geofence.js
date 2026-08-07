// Mandir location, Harinagar (confirmed with the community admin).
// Fixed on purpose: if Yuva Sabha is ever held off-site, the older
// non-geofenced attendance site is used instead.
const MANDIR_LAT = 22.314688;
const MANDIR_LNG = 73.153199;
// Widened from 50m after on-site testing: phones inside the sabha hall read
// as outside the fence (indoor GPS drift + the hall sits off the pin).
const RADIUS_METERS = 100;

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function distanceFromMandirMeters(lat, lng) {
  return haversineDistanceMeters(lat, lng, MANDIR_LAT, MANDIR_LNG);
}

function isWithinGeofence(lat, lng) {
  return distanceFromMandirMeters(lat, lng) <= RADIUS_METERS;
}

module.exports = { distanceFromMandirMeters, isWithinGeofence, RADIUS_METERS };
