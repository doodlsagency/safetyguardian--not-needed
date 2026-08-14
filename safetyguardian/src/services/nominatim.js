// Nominatim Search API — restricted to West Bengal
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

export async function searchPlaces(query) {
  if (!query || query.trim().length < 2) return []
  
  const params = new URLSearchParams({
    q: query + ', West Bengal, India',
    format: 'json',
    limit: 8,
    countrycodes: 'in',
    viewbox: '85.8,21.5,89.9,27.3',
    bounded: 1,
    addressdetails: 1,
  })

  const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: { 'Accept-Language': 'en' },
  })
  if (!res.ok) throw new Error('Nominatim error')
  const data = await res.json()
  
  // Filter to West Bengal only
  return data.filter(item => {
    const addr = item.address || {}
    return (
      addr.state === 'West Bengal' ||
      addr.county?.includes('West Bengal') ||
      item.display_name?.includes('West Bengal')
    )
  }).map(item => ({
    id: item.place_id,
    name: item.display_name?.split(',')[0] || query,
    displayName: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    type: item.type,
    address: item.address,
  }))
}

export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({ lat, lon: lng, format: 'json', addressdetails: 1 })
  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
    headers: { 'Accept-Language': 'en' },
  })
  if (!res.ok) throw new Error('Reverse geocode error')
  return res.json()
}
