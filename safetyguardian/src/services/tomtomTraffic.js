const API_KEY = import.meta.env.VITE_TOMTOM_API_KEY;

const BASE_URL = "https://api.tomtom.com/traffic/services/4";

export async function getTrafficFlow(minLat, minLon, maxLat, maxLon) {
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;

  const url =
    `${BASE_URL}/flowSegmentData/relative0/10/json` +
    `?key=${API_KEY}` +
    `&bbox=${bbox}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`TomTom API Error: ${res.status}`);
  }

  return await res.json();
}

export async function getTrafficIncidents(minLat, minLon, maxLat, maxLon) {
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;

  const url =
    `https://api.tomtom.com/traffic/services/5/incidentDetails` +
    `?key=${API_KEY}` +
    `&bbox=${bbox}` +
    `&fields={incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description}}}}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`TomTom API Error: ${res.status}`);
  }

  return await res.json();
}