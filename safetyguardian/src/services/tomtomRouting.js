/**
 * tomtomRouting.js — TomTom Routing API service
 *
 * Routing strategy (3 parallel calls for full road coverage):
 *   Route 0 — fastest       → traffic-aware, prefers main roads
 *   Route 1 — shortest      → distance-only, uses ALL roads (alleys, lanes, residential)
 *   Route 2 — fastest alt   → second-best main-road path
 *
 * Traffic visualization:
 *   Returns `trafficSections` per route so the UI can color the polyline
 *   exactly like Google Maps (blue=clear, orange=moderate, red=heavy).
 *   No background tile layers — traffic is drawn ON the route line itself.
 */

const API_KEY  = import.meta.env.VITE_TOMTOM_API_KEY
const BASE_URL = 'https://api.tomtom.com/routing/1'

// ─── Transport mode map ────────────────────────────────────────────────────────
const TOMTOM_MODE = {
  driving: 'car',
  walking: 'pedestrian',
  cycling: 'bicycle',
}

export const MODE_LABELS = {
  driving: { label: 'Drive', icon: 'directions_car',  color: '#004ac6', speed: '40 km/h avg' },
  walking: { label: 'Walk',  icon: 'directions_walk', color: '#10B981', speed: '5 km/h avg'  },
  cycling: { label: 'Cycle', icon: 'directions_bike', color: '#F59E0B', speed: '15 km/h avg' },
}

// ─── Traffic segment colors (Google Maps palette, no neon) ────────────────────
export const TRAFFIC_COLORS = {
  clear:    '#3d85c8',   // Solid blue — free flowing
  moderate: '#F59E0B',   // Amber — minor/moderate delay
  heavy:    '#EF4444',   // Red — significant/major delay
}

// ─── Build URL ────────────────────────────────────────────────────────────────
function buildUrl(fromLat, fromLng, toLat, toLng, travelMode, routeType, maxAlternatives = 0) {
  return (
    `${BASE_URL}/calculateRoute/` +
    `${fromLat},${fromLng}:${toLat},${toLng}/json` +
    `?key=${API_KEY}` +
    `&travelMode=${travelMode}` +
    `&routeType=${routeType}` +
    `&traffic=true` +
    `&maxAlternatives=${maxAlternatives}` +
    `&instructionsType=tagged` +
    `&sectionType=traffic`   // returns per-segment traffic data for polyline coloring
  )
}

// ─── Main route fetcher — 3 parallel strategies ───────────────────────────────
export async function getRoute(fromLat, fromLng, toLat, toLng, mode = 'driving') {
  const travelMode = TOMTOM_MODE[mode] || 'car'

  const [resultA, resultB] = await Promise.allSettled([
    fetch(buildUrl(fromLat, fromLng, toLat, toLng, travelMode, 'fastest', 1)).then(r => r.json()),
    fetch(buildUrl(fromLat, fromLng, toLat, toLng, travelMode, 'shortest', 0)).then(r => r.json()),
  ])

  const routes = []

  if (resultA.status === 'fulfilled' && resultA.value.routes?.length) {
    routes.push(parseRoute(resultA.value.routes[0], 0, mode))      // Balanced
    if (resultA.value.routes[1]) {
      routes.push(parseRoute(resultA.value.routes[1], 2, mode))    // Fastest alt
    }
  }

  if (resultB.status === 'fulfilled' && resultB.value.routes?.length) {
    routes.splice(1, 0, parseRoute(resultB.value.routes[0], 1, mode)) // Local (all roads)
  }

  if (routes.length === 0) throw new Error('No routes found from TomTom')

  return routes.map((r, i) => ({ ...r, index: i }))
}

// ─── Single reroute (current GPS position → destination) ──────────────────────
export async function getReroutedRoute(fromLat, fromLng, toLat, toLng, mode = 'driving') {
  const travelMode = TOMTOM_MODE[mode] || 'car'
  const url = buildUrl(fromLat, fromLng, toLat, toLng, travelMode, 'fastest', 0)
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`TomTom Reroute Error: ${res.status}`)
  const data = await res.json()
  if (!data.routes?.length) throw new Error('No reroute found')
  return parseRoute(data.routes[0], 0, mode)
}

// ─── Parse a raw TomTom route into our internal format ────────────────────────
function parseRoute(route, index, mode) {
  const summary = route.summary

  // Flatten all leg points → [[lat, lng], ...]
  const geometry = route.legs?.flatMap(leg =>
    leg.points.map(p => [p.latitude, p.longitude])
  ) || []

  // Turn-by-turn steps
  const steps = parseInstructions(route.guidance?.instructions || [])

  // Traffic sections — map TomTom indices to our geometry array
  // sectionType=traffic returns one section per congested segment:
  //   startPointIndex / endPointIndex = indices into the flat geometry array
  //   simpleCategory: NO_DELAY | MINOR_DELAY | SIGNIFICANT_DELAY | MAJOR_DELAY
  //   effectiveSpeedInKmh / freeFlowSpeedInKmh = speed ratio for color picking
  const trafficSections = (route.sections || [])
    .filter(s => s.sectionType === 'TRAFFIC')
    .map(s => ({
      startIdx:        s.startPointIndex,
      endIdx:          s.endPointIndex,
      category:        s.simpleCategory || 'UNDEFINED',
      speedKmh:        s.effectiveSpeedInKmh  || null,
      freeFlowSpeedKmh: s.freeFlowSpeedInKmh || null,
      delaySeconds:    s.delayInSeconds       || 0,
    }))

  return {
    index,
    mode,
    geometry,
    steps,
    trafficSections,        // used by buildTrafficSegments() in the UI
    distance:         summary.lengthInMeters,
    duration:         summary.travelTimeInSeconds,
    distanceKm:       (summary.lengthInMeters / 1000).toFixed(1),
    durationMin:      Math.round(summary.travelTimeInSeconds / 60),
    trafficDelay:     summary.trafficDelayInSeconds    || 0,
    trafficDelayMin:  Math.round((summary.trafficDelayInSeconds || 0) / 60),
    liveEtaSeconds:   summary.travelTimeInSeconds,
    arrivalTime:      summary.arrivalTime || null,
  }
}

// ─── Instructions parser ──────────────────────────────────────────────────────
function parseInstructions(instructions) {
  return instructions.map(inst => ({
    instruction: (inst.message || '').replace(/<[^>]+>/g, '').trim() || maneuverText(inst.maneuver),
    distance:    inst.routeOffsetInMeters ?? 0,
    type:        inst.maneuver || 'straight',
    icon:        getStepIcon(inst.maneuver),
    laneInfo:    inst.laneInfo ? { lanes: inst.laneInfo.lanes || [], targetLane: inst.laneInfo.targetLane } : null,
    point:       inst.point ? [inst.point.latitude, inst.point.longitude] : null,
    street:      inst.street || '',
  }))
}

function maneuverText(maneuver) {
  const m = (maneuver || '').toLowerCase()
  if (m.includes('left'))       return 'Turn left'
  if (m.includes('right'))      return 'Turn right'
  if (m.includes('uturn'))      return 'Make a U-turn'
  if (m.includes('roundabout')) return 'Take the roundabout'
  if (m.includes('arrive'))     return 'Arrive at destination'
  if (m.includes('depart'))     return 'Depart'
  return 'Continue straight'
}

function getStepIcon(maneuver) {
  const m = (maneuver || '').toLowerCase()
  if (m.includes('left'))       return 'turn_left'
  if (m.includes('right'))      return 'turn_right'
  if (m.includes('uturn'))      return 'u_turn_left'
  if (m.includes('roundabout')) return 'roundabout_right'
  if (m.includes('arrive'))     return 'flag'
  if (m.includes('depart'))     return 'my_location'
  if (m.includes('ferry'))      return 'directions_ferry'
  return 'straight'
}

// ─── Traffic segment builder ─────────────────────────────────────────────────
/**
 * Splits a route's geometry into colored segments based on TomTom traffic data.
 * Used in the UI to render the polyline exactly like Google Maps:
 *   — Blue  : free-flowing (no delay)
 *   — Amber : minor/moderate congestion
 *   — Red   : heavy congestion
 *
 * Rules:
 *   1. All points default to TRAFFIC_COLORS.clear (blue).
 *   2. Each traffic section paints its index range with the appropriate color.
 *   3. Consecutive same-colored points are merged into one segment.
 *   4. Adjacent segments share one overlap point to eliminate gaps in the line.
 *
 * @param {Array}  geometry        [[lat,lng], ...] from route.geometry
 * @param {Array}  trafficSections from route.trafficSections
 * @returns {Array} [{ points: [[lat,lng],...], color: '#hex' }, ...]
 */
export function buildTrafficSegments(geometry, trafficSections) {
  if (!geometry || geometry.length < 2) return []

  // Step 1 — paint every point blue by default
  const pointColors = new Array(geometry.length).fill(TRAFFIC_COLORS.clear)

  // Step 2 — apply traffic section colors
  if (trafficSections && trafficSections.length > 0) {
    trafficSections.forEach(section => {
      const color = pickTrafficColor(section)
      const start = Math.max(0, section.startIdx)
      const end   = Math.min(geometry.length - 1, section.endIdx)
      for (let i = start; i <= end; i++) {
        pointColors[i] = color
      }
    })
  }

  // Step 3 — group consecutive same-color points into segments
  //           Overlap by 1 point so joins between segments are seamless
  const segments = []
  let segColor  = pointColors[0]
  let segPoints = [geometry[0]]

  for (let i = 1; i < geometry.length; i++) {
    const c = pointColors[i]
    if (c === segColor) {
      segPoints.push(geometry[i])
    } else {
      // End current segment — include this boundary point for a seamless join
      segPoints.push(geometry[i])
      if (segPoints.length >= 2) segments.push({ points: [...segPoints], color: segColor })
      // Start next segment from the same boundary point
      segColor  = c
      segPoints = [geometry[i]]
    }
  }

  if (segPoints.length >= 2) segments.push({ points: segPoints, color: segColor })

  return segments
}

/**
 * Pick a traffic color for a section.
 * Primary: speed ratio (effectiveSpeed / freeFlowSpeed)
 * Fallback: TomTom simpleCategory enum
 */
function pickTrafficColor(section) {
  if (section.speedKmh && section.freeFlowSpeedKmh) {
    const ratio = section.speedKmh / section.freeFlowSpeedKmh
    if (ratio < 0.5)  return TRAFFIC_COLORS.heavy    // < 50% of free-flow = red
    if (ratio < 0.75) return TRAFFIC_COLORS.moderate // 50–75%            = amber
    return TRAFFIC_COLORS.clear                       // > 75%             = blue
  }
  switch (section.category) {
    case 'MAJOR_DELAY':       return TRAFFIC_COLORS.heavy
    case 'SIGNIFICANT_DELAY': return TRAFFIC_COLORS.moderate
    case 'MINOR_DELAY':       return TRAFFIC_COLORS.moderate
    default:                  return TRAFFIC_COLORS.clear
  }
}

/**
 * Returns a human-readable traffic status string + color for a route.
 * Used in route cards to show "Heavy traffic +9 min".
 */
export function getTrafficStatus(route) {
  if (!route.trafficSections?.length || route.trafficDelay < 30) {
    return { label: 'Clear roads', color: TRAFFIC_COLORS.clear, icon: 'check_circle' }
  }
  const hasHeavy = route.trafficSections.some(s =>
    s.category === 'MAJOR_DELAY' ||
    (s.speedKmh && s.freeFlowSpeedKmh && s.speedKmh / s.freeFlowSpeedKmh < 0.5)
  )
  if (hasHeavy) {
    const extra = route.trafficDelayMin > 0 ? `+${route.trafficDelayMin} min` : ''
    return { label: `Heavy traffic ${extra}`.trim(), color: TRAFFIC_COLORS.heavy, icon: 'traffic' }
  }
  const extra = route.trafficDelayMin > 0 ? `+${route.trafficDelayMin} min` : ''
  return { label: `Slow traffic ${extra}`.trim(), color: TRAFFIC_COLORS.moderate, icon: 'speed' }
}

// ─── Formatters ───────────────────────────────────────────────────────────────
export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Traffic tile URL builders (kept for possible future use, NOT used on home) ─
export function getTrafficTileUrl(style = 'relative') {
  return `https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${API_KEY}`
}

export function getIncidentTileUrl() {
  return `https://api.tomtom.com/traffic/map/4/tile/incidents/s3/{z}/{x}/{y}.png?key=${API_KEY}`
}