// Overpass API — fetch nearby amenities within West Bengal
const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter'

export async function fetchNearbyPlaces(lat, lng, radiusMeters = 2000, categories = []) {
  const categoryFilters = categories.length
    ? categories.map(c => `node[${c}](around:${radiusMeters},${lat},${lng});`).join('\n')
    : `
      node[amenity=hospital](around:${radiusMeters},${lat},${lng});
      node[amenity=police](around:${radiusMeters},${lat},${lng});
      node[amenity=fire_station](around:${radiusMeters},${lat},${lng});
      node[amenity=pharmacy](around:${radiusMeters},${lat},${lng});
      node[amenity=fuel](around:${radiusMeters},${lat},${lng});
    `

  const query = `[out:json][timeout:15];
(
  ${categoryFilters}
);
out body;`

  const res = await fetch(OVERPASS_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })
  
  if (!res.ok) throw new Error('Overpass API error')
  const data = await res.json()
  
  return data.elements.map(el => ({
    id: el.id,
    lat: el.lat,
    lng: el.lon,
    name: el.tags?.name || el.tags?.amenity || 'Unnamed',
    amenity: el.tags?.amenity || 'unknown',
    tags: el.tags,
    distance: haversineDistance(lat, lng, el.lat, el.lon),
  })).sort((a, b) => a.distance - b.distance)
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3
  const p1 = lat1 * Math.PI / 180
  const p2 = lat2 * Math.PI / 180
  const dp = (lat2 - lat1) * Math.PI / 180
  const dl = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatNearbyDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
