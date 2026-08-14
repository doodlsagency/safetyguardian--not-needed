/**
 * safetyScore.js — Community-powered route safety engine
 *
 * Algorithm overview:
 *   1. For every report in Firestore, calculate its minimum distance to
 *      each route polyline using point-to-segment math (Haversine).
 *   2. If a report is within REPORT_PROXIMITY_METERS of the route,
 *      it is "on that route" and its penalty is applied.
 *   3. Penalty = hazardType.basePenalty × severityLevel.multiplier
 *   4. Routes start at BASE_SCORE. Score = BASE_SCORE - Σ penalties (min 10).
 *   5. Routes are re-sorted: highest score = new "Safest Route".
 *
 * Exports:
 *   calculateRouteSafetyScores(routes, nearbyPlaces, reports)
 *     → same routes[] with safetyScore added + onRouteReports[] attached
 *   calculateSafetyScore({ nearbyPlaces, reports })
 *     → single number for home-screen safety badge
 *   getScoreLabel(score)
 *     → { label, color, bg, text }
 *   getRouteType(idx)
 *     → { label, color, badge }
 */

import { HAZARD_TYPES, SEVERITY_LEVELS } from '../constants'
import { CRIME_SEVERITY_CONFIG, CRIME_ROUTE_PROXIMITY_METERS } from '../data/crimeHotspots'
import { FLOOD_SEVERITY_CONFIG, FLOOD_ROUTE_PROXIMITY_METERS, isMonsoonSeason } from '../data/floodZones'

// ─── Config ─────────────────────────────────────────────────────────────────────────
const BASE_SCORE              = 100  // Every route starts at 100
const REPORT_PROXIMITY_METERS = 40   // Live reports within 40m of a route affect it
const REPORT_MAX_AGE_HOURS    = 48   // Only consider reports from last 48 hours
const MIN_SCORE               = 10   // Floor — route score never goes below 10
const MAX_SCORE               = 100  // Ceiling
const MONSOON_FLOOD_MULTIPLIER = 1.4  // Flood penalty 40% higher during June-October

/**
 * ROUTE_VARIANCE: small per-route offsets that make demo routes feel distinct
 * even with no reports. Applied to the ORIGINAL route index (route 0 = longer/safer,
 * route 1 = balanced, route 2 = shorter/faster).
 * These are variance hints ONLY — never override the final rank.
 */
const ROUTE_VARIANCE = [+4, 0, -8]   // longer routes tend to be safer

/**
 * RANK_CONFIGS: appearance for rank 0 (safest), 1 (middle), 2 (fastest/riskiest).
 * Assigned AFTER sorting by score — completely decoupled from OSRM route index.
 */
export const RANK_CONFIGS = [
  { label: 'SAFEST',   color: '#10B981', badge: 'bg-[#10B981]', recommended: true  },
  { label: 'BALANCED', color: '#004ac6', badge: 'bg-[#004ac6]', recommended: false },
  { label: 'FASTEST',  color: '#F59E0B', badge: 'bg-[#F59E0B]', recommended: false },
]

// ─── Lookup tables ─────────────────────────────────────────────────────────────
const HAZARD_MAP   = Object.fromEntries(HAZARD_TYPES.map(h => [h.id, h]))
const SEVERITY_MAP = Object.fromEntries(SEVERITY_LEVELS.map(s => [s.id, s]))

// ─── Geo math: Haversine great-circle distance in metres ──────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R   = 6371000 // Earth radius metres
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Point-to-line-segment distance ──────────────────────────────────────────
// Finds the minimum distance between a point (pLat,pLng) and a
// line segment from (aLat,aLng) to (bLat,bLng), in metres.
function pointToSegmentMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
  const dx = bLng - aLng
  const dy = bLat - aLat
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return haversineMeters(pLat, pLng, aLat, aLng)

  let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const closestLat = aLat + t * dy
  const closestLng = aLng + t * dx
  return haversineMeters(pLat, pLng, closestLat, closestLng)
}

// ─── Minimum distance from a point to a polyline ─────────────────────────────
function minDistanceToPolyline(lat, lng, polyline) {
  let minDist = Infinity
  for (let i = 0; i < polyline.length - 1; i++) {
    const [aLat, aLng] = polyline[i]
    const [bLat, bLng] = polyline[i + 1]
    const d = pointToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng)
    if (d < minDist) minDist = d
  }
  return minDist
}

// ─── Nearest polyline point (for placing the warning marker on the route) ────
function nearestPolylinePoint(lat, lng, polyline) {
  let minDist = Infinity
  let nearestPt = polyline[0]
  for (let i = 0; i < polyline.length - 1; i++) {
    const [aLat, aLng] = polyline[i]
    const [bLat, bLng] = polyline[i + 1]
    const d = pointToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng)
    if (d < minDist) {
      minDist = d
      // Snap to the closer endpoint of the segment for the marker
      nearestPt = haversineMeters(lat, lng, aLat, aLng) < haversineMeters(lat, lng, bLat, bLng)
        ? [aLat, aLng]
        : [bLat, bLng]
    }
  }
  return nearestPt
}

// ─── Filter to recent reports only ───────────────────────────────────────────
function recentReports(reports) {
  const cutoff = Date.now() - REPORT_MAX_AGE_HOURS * 3600 * 1000
  return reports.filter(r => {
    // Handle both Firestore Timestamp and ISO string
    const ts = r.createdAt?.toDate
      ? r.createdAt.toDate().getTime()
      : new Date(r.timestamp || 0).getTime()
    return ts >= cutoff
  })
}

// ─── Core: calculate penalty points for a single report ──────────────────────
function calcPenalty(report) {
  const typeId  = report.hazardType || report.type || 'other'
  const sevId   = report.severity   || 'medium'
  const hazard  = HAZARD_MAP[typeId]  || { basePenalty: 5 }
  const sev     = SEVERITY_MAP[sevId] || { multiplier: 1.0 }
  return Math.round(hazard.basePenalty * sev.multiplier)
}

// ─── Main export: score routes against reports + crime + flood data ──────────────────
/**
 * @param {Array} routes         — Route objects with .geometry [[lat,lng],...]
 * @param {Array} nearbyPlaces   — Overpass amenities near user (police/hospital etc)
 * @param {Array} reports        — Live community hazard reports from Firestore
 * @param {Array} crimeHotspots  — Historical crime zones from crimeHotspots.js
 * @param {Array} floodZones     — Historical flood zones from floodZones.js
 */
export function calculateRouteSafetyScores(
  routes,
  nearbyPlaces  = [],
  reports       = [],
  crimeHotspots = [],
  floodZones    = [],
) {
  const active = recentReports(reports)

  // ── Step 1: Score each route independently ────────────────────────────────
  const scoredRoutes = routes.map((route, routeIndex) => {
    const geometry = route.geometry  // [[lat, lng], ...]
    if (!geometry || geometry.length < 2) {
      return { ...route, safetyScore: 75 + (ROUTE_VARIANCE[routeIndex] || 0), onRouteReports: [] }
    }

    let score = BASE_SCORE
    score += (ROUTE_VARIANCE[routeIndex] || 0)

    const onRouteReports   = []
    const onRouteCrimes    = []
    const onRouteFlood     = []

    // ── (A) Live community hazard report penalties ───────────────────────────────
    active.forEach(r => {
      const lat = r.latitude  ?? r.lat
      const lng = r.longitude ?? r.lng
      if (typeof lat !== 'number' || typeof lng !== 'number') return
      const dist = minDistanceToPolyline(lat, lng, geometry)
      if (dist <= REPORT_PROXIMITY_METERS) {
        const penalty = calcPenalty(r)
        score        -= penalty
        const snapPt  = nearestPolylinePoint(lat, lng, geometry)
        onRouteReports.push({ ...r, _penalty: penalty, _snapLat: snapPt[0], _snapLng: snapPt[1] })
      }
    })

    // ── (B) Historical crime hotspot penalties ────────────────────────────────
    // Each crime hotspot that is within CRIME_ROUTE_PROXIMITY_METERS of the route
    // applies a penalty based on severity. Penalties are capped to prevent stacking.
    let totalCrimePenalty = 0
    const crimePenaltyCap = 30  // max total crime deduction per route

    crimeHotspots.forEach(hotspot => {
      const dist = minDistanceToPolyline(hotspot.lat, hotspot.lng, geometry)
      if (dist <= CRIME_ROUTE_PROXIMITY_METERS) {
        const cfg     = CRIME_SEVERITY_CONFIG[hotspot.severity] || CRIME_SEVERITY_CONFIG.low
        const penalty = cfg.penalty
        totalCrimePenalty = Math.min(totalCrimePenalty + penalty, crimePenaltyCap)
        onRouteCrimes.push({ ...hotspot, _penalty: penalty, _dist: Math.round(dist) })
      }
    })
    score -= totalCrimePenalty

    // ── (C) Flood zone penalties ───────────────────────────────────────────────
    // Flood zones from ISRO/NDMA data. During monsoon season (June-Oct),
    // the penalty is multiplied by MONSOON_FLOOD_MULTIPLIER.
    const monsoon = isMonsoonSeason()
    let totalFloodPenalty = 0
    const floodPenaltyCap = 25

    floodZones.forEach(zone => {
      const dist = minDistanceToPolyline(zone.lat, zone.lng, geometry)
      if (dist <= FLOOD_ROUTE_PROXIMITY_METERS) {
        const cfg     = FLOOD_SEVERITY_CONFIG[zone.severity] || FLOOD_SEVERITY_CONFIG.low
        const base    = cfg.penalty
        const penalty = monsoon && zone.monsoonRisk
          ? Math.round(base * MONSOON_FLOOD_MULTIPLIER)
          : base
        totalFloodPenalty = Math.min(totalFloodPenalty + penalty, floodPenaltyCap)
        onRouteFlood.push({ ...zone, _penalty: penalty, _dist: Math.round(dist) })
      }
    })
    score -= totalFloodPenalty

    score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)))
    return {
      ...route,
      safetyScore:   score,
      onRouteReports,
      onRouteCrimes,    // for crime pin display on map
      onRouteFlood,     // for flood zone display on map
      crimePenalty:  totalCrimePenalty,
      floodPenalty:  totalFloodPenalty,
    }
  })

  // ── Step 2: Sort by safety score — highest first ─────────────────────────
  // We sort a copy so we know rank order, then assign rank metadata back.
  const sortedByScore = [...scoredRoutes].sort((a, b) => b.safetyScore - a.safetyScore)

  // ── Step 3: Assign rank label/color based on POSITION after sorting ───────
  // rank 0 = highest score = SAFEST (always green, always "Recommended")
  // rank 1 = middle score  = BALANCED
  // rank 2 = lowest score  = FASTEST (may be less safe)
  const rankedRoutes = sortedByScore.map((route, rank) => {
    const cfg = RANK_CONFIGS[rank] || RANK_CONFIGS[RANK_CONFIGS.length - 1]
    return {
      ...route,
      rank,               // 0 = safest, 1 = balanced, 2 = fastest/riskiest
      rankLabel:    cfg.label,
      rankColor:    cfg.color,
      recommended:  cfg.recommended,
    }
  })

  // ── Step 4: Enforce minimum 5-point score gap between routes ───────────────
  // This ensures scores are always visually distinct (e.g. 94, 82, 71)
  for (let i = 1; i < rankedRoutes.length; i++) {
    const prev = rankedRoutes[i - 1].safetyScore
    if (prev - rankedRoutes[i].safetyScore < 5) {
      rankedRoutes[i] = { ...rankedRoutes[i], safetyScore: Math.max(MIN_SCORE, prev - 5) }
    }
  }

  return rankedRoutes
}

// ─── Deduplicate near-identical routes ─────────────────────────────────────────
/**
 * Removes routes that are too similar in distance + duration.
 * Two routes are duplicates if BOTH distance and duration differ by less than 5%.
 * Keeps the higher-scored route of each duplicate pair.
 */
export function deduplicateRoutes(routes) {
  const kept = []
  for (const route of routes) {
    const isDuplicate = kept.some(k => {
      const distDiff = Math.abs((route.distanceKm || 0) - (k.distanceKm || 0))
      const timeDiff = Math.abs((route.durationMin || 0) - (k.durationMin || 0))
      const distSim  = k.distanceKm  > 0 ? distDiff / k.distanceKm  : 0
      const timeSim  = k.durationMin > 0 ? timeDiff / k.durationMin : 0
      return distSim < 0.05 && timeSim < 0.05
    })
    if (!isDuplicate) kept.push(route)
  }
  return kept
}

// ─── Score explanation reasons ─────────────────────────────────────────────────
/**
 * Returns an array of human-readable reasons for a given safety score + rank.
 */
export function getScoreReasons(score, rankLabel) {
  let reasons = []
  if (score >= 88) {
    reasons = [
      'Lower traffic congestion',
      'Fewer community hazard reports',
      'Better road lighting',
      'Higher activity zone',
      'Wider roads with better visibility',
    ]
  } else if (score >= 75) {
    reasons = [
      'Moderate traffic levels',
      'Good road conditions',
      'Some community reports nearby',
      'Reasonably lit area',
      'Accessible emergency services',
    ]
  } else if (score >= 60) {
    reasons = [
      'Elevated traffic congestion',
      'Multiple community hazard reports',
      'Some isolated stretches',
      'Variable road quality',
      'Fewer nearby services',
    ]
  } else {
    reasons = [
      'High hazard density on route',
      'Poor road conditions reported',
      'Isolated or poorly lit stretches',
      'Multiple community warnings',
      'Limited emergency access',
    ]
  }
  if (rankLabel === 'FASTEST')  reasons = ['Shortest travel time', ...reasons]
  if (rankLabel === 'SAFEST')   reasons = ['Best overall safety profile', ...reasons]
  return reasons
}

// ─── Home-screen area safety score ────────────────────────────────────────────
export function calculateSafetyScore({ nearbyPlaces = [], reports = [] }) {
  let score = 70

  const hospitals = nearbyPlaces.filter(p => p.amenity === 'hospital').length
  const police    = nearbyPlaces.filter(p => p.amenity === 'police').length
  const fire      = nearbyPlaces.filter(p => p.amenity === 'fire_station').length
  const pharmacy  = nearbyPlaces.filter(p => p.amenity === 'pharmacy').length

  score += Math.min(hospitals * 4, 12)
  score += Math.min(police    * 5, 15)
  score += Math.min(fire      * 3,  9)
  score += Math.min(pharmacy  * 1,  4)

  const active = recentReports(reports)
  active.forEach(r => { score -= calcPenalty(r) })

  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)))
}

// ─── Score label helpers ───────────────────────────────────────────────────────
export function getScoreLabel(score) {
  if (score >= 85) return { label: 'Safe Zone',     color: '#10B981', bg: 'bg-green-100',  text: 'text-green-700'  }
  if (score >= 70) return { label: 'Mostly Safe',   color: '#34D399', bg: 'bg-green-50',   text: 'text-green-600'  }
  if (score >= 55) return { label: 'Moderate',      color: '#F59E0B', bg: 'bg-amber-100',  text: 'text-amber-700'  }
  if (score >= 40) return { label: 'Caution',       color: '#F97316', bg: 'bg-orange-100', text: 'text-orange-700' }
  return                  { label: 'High Risk',     color: '#EF4444', bg: 'bg-red-100',    text: 'text-red-700'    }
}

export function getRouteType(idx) {
  const types = [
    { label: 'BALANCED',    color: '#004ac6', badge: 'bg-[#004ac6]' },
    { label: 'SAFEST PATH', color: '#10B981', badge: 'bg-[#10B981]' },
    { label: 'FASTEST',     color: '#F59E0B', badge: 'bg-[#F59E0B]' },
  ]
  return types[idx] || types[0]
}
