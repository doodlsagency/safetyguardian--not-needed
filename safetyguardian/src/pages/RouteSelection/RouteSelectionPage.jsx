/**
 * RouteSelectionPage.jsx
 *
 * Fully upgraded with:
 *   - Geometric route-report intersection (via safetyScore engine)
 *   - Hazard warning pins snapped directly onto route polylines
 *   - Community Intelligence panel per route card (reports on that route)
 *   - Dynamic score sorting (highest score = new "Safest Route")
 *   - "N Hazards on Route" badge per route card
 *   - Real-time: re-scores whenever Zustand reports update (onSnapshot in HomePage)
 */

import { useEffect, useState, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../../context/store'
import {
  getRoute, MODE_LABELS,
  buildTrafficSegments, getTrafficStatus, TRAFFIC_COLORS,
  getTrafficTileUrl, getIncidentTileUrl,
} from '../../services/tomtomRouting'
import { calculateRouteSafetyScores, getScoreLabel, deduplicateRoutes, getScoreReasons } from '../../services/safetyScore'
import { HAZARD_TYPES, SEVERITY_COLORS } from '../../constants'
import { CRIME_HOTSPOTS, CRIME_SEVERITY_CONFIG } from '../../data/crimeHotspots'
import { FLOOD_ZONES_STATIC, FLOOD_SEVERITY_CONFIG, fetchLiveFloodData, isMonsoonSeason } from '../../data/floodZones'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ─── Constants ────────────────────────────────────────────────────────────────
const HAZARD_MAP = Object.fromEntries(HAZARD_TYPES.map(h => [h.id, h]))

// ─── Icons ────────────────────────────────────────────────────────────────────
const destIcon = L.divIcon({
  html: `<div style="width:32px;height:32px;border-radius:50%;background:#EF4444;border:3px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.25);">
    <span class="material-symbols-outlined icon-filled" style="color:white;font-size:16px;">place</span>
  </div>`,
  className: '', iconSize: [32, 32], iconAnchor: [16, 16],
})

const userIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#004ac6;border:3px solid white;box-shadow:0 0 0 5px rgba(0,74,198,0.2);"></div>`,
  className: '', iconSize: [18, 18], iconAnchor: [9, 9],
})

const createHazardPin = (severity, matIcon) => {
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.default
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};border:2.5px solid white;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px ${color}60;">
      <span class="material-symbols-outlined icon-filled" style="color:white;font-size:12px;">${matIcon || 'warning'}</span>
    </div>`,
    className:   '',
    iconSize:    [28, 28],
    iconAnchor:  [14, 14],
    popupAnchor: [0, -16],
  })
}

// ─── Map helpers ──────────────────────────────────────────────────────────────
function MapFit({ startLat, startLng, destLat, destLng }) {
  const map = useMap()
  useEffect(() => {
    if (destLat === undefined || destLng === undefined) return
    map.fitBounds([[startLat, startLng], [destLat, destLng]], { padding: [80, 80], maxZoom: 15, animate: true })
  }, [destLat, destLng, map, startLat, startLng])
  return null
}

const TRANSPORT_MODES = [
  { id: 'driving', label: 'Drive',  icon: 'directions_car',  color: '#004ac6' },
  { id: 'cycling', label: 'Cycle',  icon: 'directions_bike', color: '#F59E0B' },
  { id: 'walking', label: 'Walk',   icon: 'directions_walk', color: '#10B981' },
]

// ─── Time ago helper ───────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return ''
  const d    = ts?.toDate ? ts.toDate() : new Date(ts)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1)  return 'Just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RouteSelectionPage() {
  const navigate = useNavigate()
  const {
    userLocation, startLocation, destination, setRoutes,
    selectedRouteIdx, setSelectedRouteIdx,
    nearbyPlaces, reports, setIsNavigating,
  } = useAppStore()

  const [loading,        setLoading]        = useState(false)
  const [rawRoutes,      setRawRoutes]      = useState([])
  const [transportMode,  setTransportMode]  = useState('driving')
  const [sheetOpen,      setSheetOpen]      = useState(true)
  // Overlay toggles
  const [showCrimes,     setShowCrimes]     = useState(false)
  const [showFloodRisk,  setShowFloodRisk]  = useState(false)
  const [showTraffic,    setShowTraffic]    = useState(false)
  const [expandedRouteIdx, setExpandedRouteIdx] = useState(null) // for 'Why this score?' accordion
  // Live flood discharge data from Open-Meteo
  const [liveFloodData,  setLiveFloodData]  = useState([])
  const [floodLoading,   setFloodLoading]   = useState(false)

  // ── Fetch live flood discharge on mount ────────────────────────────────────
  useEffect(() => {
    setFloodLoading(true)
    fetchLiveFloodData()
      .then(data => setLiveFloodData(data))
      .catch(() => setLiveFloodData([]))
      .finally(() => setFloodLoading(false))
  }, [])

  // ── Score routes + always apply traffic penalty (even when visual is off) ─────────
  // Traffic penalty is ALWAYS deducted from safety score because congestion is
  // a real safety risk regardless of whether the tiles are visible.
  const TRAFFIC_PENALTY_MAP = {
    heavy:    15,   // red   — major delay, high risk
    moderate: 8,    // amber — slow movement, elevated risk
    clear:    0,    // blue  — free-flow, no penalty
  }

  const routesWithScores = useMemo(() => {
    if (!rawRoutes.length) return []

    // Step 1: Safety score from reports + crime zones + flood zones
    const baseScored = calculateRouteSafetyScores(
      rawRoutes, nearbyPlaces, reports,
      CRIME_HOTSPOTS,      // historical crime zones (NCRB/news data)
      FLOOD_ZONES_STATIC,  // ISRO/NDMA flood zones
    )

    // Step 2: Add traffic penalty + deduplicate
    const withTraffic = baseScored.map(route => {
      const trafficInfo = getTrafficStatus(route)
      let trafficLevel = 'clear'
      if (trafficInfo.color === TRAFFIC_COLORS.heavy) trafficLevel = 'heavy'
      else if (trafficInfo.color === TRAFFIC_COLORS.moderate) trafficLevel = 'moderate'
      const trafficPenalty = TRAFFIC_PENALTY_MAP[trafficLevel] || 0
      return { ...route, safetyScore: Math.max(10, route.safetyScore - trafficPenalty), trafficPenalty, trafficLevel, trafficInfo }
    })
    return deduplicateRoutes(withTraffic)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRoutes, nearbyPlaces, reports])

  useEffect(() => {
    if (!destination) { navigate('/search'); return }
    loadRoutes(transportMode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, startLocation])

  const startLoc = {
    ...(startLocation || userLocation),
    lat: parseFloat((startLocation || userLocation).lat),
    lng: parseFloat((startLocation || userLocation).lng || (startLocation || userLocation).lon),
  }

  const destLoc = destination ? {
    ...destination,
    lat: parseFloat(destination.lat),
    lng: parseFloat(destination.lng || destination.lon),
  } : null

  // ── Load routes ───────────────────────────────────────────────────────────
  const loadRoutes = async (mode) => {
    setLoading(true)
    setRawRoutes([])
    try {
      const fetched = await getRoute(startLoc.lat, startLoc.lng, destLoc.lat, destLoc.lng, mode)
      setRawRoutes(fetched)
      setRoutes(fetched)
      setSelectedRouteIdx(0) // 0 = safest after scoring sorts
    } catch {
      const modeInfo = MODE_LABELS[mode] || MODE_LABELS.driving
      const baseTime = mode === 'walking' ? 72 : mode === 'cycling' ? 36 : 14
      const demo = [
        {
          index: 0, distance: 12000, duration: baseTime * 60,
          distanceKm: '12.0', durationMin: baseTime, mode,
          trafficDelay: 420, trafficDelayMin: 7,
          geometry: [[startLoc.lat, startLoc.lng], [startLoc.lat + 0.01, startLoc.lng + 0.02], [destLoc.lat, destLoc.lng]],
          // Demo traffic sections: start is clear, middle is congested
          trafficSections: [
            { startIdx: 0, endIdx: 0, category: 'NO_DELAY',      speedKmh: 40, freeFlowSpeedKmh: 40 },
            { startIdx: 1, endIdx: 1, category: 'MAJOR_DELAY',   speedKmh: 8,  freeFlowSpeedKmh: 40 },
            { startIdx: 2, endIdx: 2, category: 'MINOR_DELAY',   speedKmh: 28, freeFlowSpeedKmh: 40 },
          ],
          steps: [
            { instruction: 'Head north on College Road',       distance: 400,  icon: 'north'      },
            { instruction: 'Turn right at NH-12',              distance: 4500, icon: 'turn_right' },
            { instruction: 'Arrive at destination',            distance: 100,  icon: 'flag'       },
          ],
        },
        {
          index: 1, distance: 15000, duration: Math.round(baseTime * 1.3) * 60,
          distanceKm: '15.0', durationMin: Math.round(baseTime * 1.3), mode,
          trafficDelay: 60, trafficDelayMin: 1,
          geometry: [
            [startLoc.lat, startLoc.lng],
            [startLoc.lat + 0.02, startLoc.lng + 0.01],
            [startLoc.lat + 0.03, startLoc.lng + 0.02],
            [destLoc.lat, destLoc.lng],
          ],
          // Demo: mostly clear with one slow patch
          trafficSections: [
            { startIdx: 0, endIdx: 1, category: 'NO_DELAY',    speedKmh: 42, freeFlowSpeedKmh: 45 },
            { startIdx: 2, endIdx: 2, category: 'MINOR_DELAY', speedKmh: 25, freeFlowSpeedKmh: 45 },
            { startIdx: 3, endIdx: 3, category: 'NO_DELAY',    speedKmh: 42, freeFlowSpeedKmh: 45 },
          ],
          steps: [
            { instruction: 'Head north via safe road',  distance: 600,  icon: 'north'    },
            { instruction: 'Pass through lit area',     distance: 8000, icon: 'straight' },
            { instruction: 'Arrive at destination',     distance: 100,  icon: 'flag'     },
          ],
        },
        {
          index: 2, distance: 9000, duration: Math.round(baseTime * 0.7) * 60,
          distanceKm: '9.0', durationMin: Math.round(baseTime * 0.7), mode,
          trafficDelay: 240, trafficDelayMin: 4,
          geometry: [
            [startLoc.lat, startLoc.lng],
            [startLoc.lat - 0.01, startLoc.lng + 0.03],
            [destLoc.lat, destLoc.lng],
          ],
          // Demo: moderate delay throughout
          trafficSections: [
            { startIdx: 0, endIdx: 0, category: 'MINOR_DELAY',        speedKmh: 22, freeFlowSpeedKmh: 40 },
            { startIdx: 1, endIdx: 1, category: 'SIGNIFICANT_DELAY',  speedKmh: 12, freeFlowSpeedKmh: 40 },
            { startIdx: 2, endIdx: 2, category: 'NO_DELAY',           speedKmh: 38, freeFlowSpeedKmh: 40 },
          ],
          steps: [
            { instruction: 'Head east on expressway', distance: 2000, icon: 'straight'  },
            { instruction: 'Turn left',               distance: 4000, icon: 'turn_left' },
            { instruction: 'Arrive at destination',   distance: 100,  icon: 'flag'      },
          ],
        },
      ]
      setRawRoutes(demo)
      setRoutes(demo)
      setSelectedRouteIdx(0) // 0 = safest after scoring sorts
    } finally {
      setLoading(false)
    }
  }

  const handleModeChange = (mode) => {
    setTransportMode(mode)
    loadRoutes(mode)
  }

  const handleStartJourney = () => {
    // Store the scored route so NavigationPage can use steps
    if (routesWithScores.length) setRoutes(routesWithScores)
    setIsNavigating(true)
    navigate('/navigate')
  }

  if (!destination) return null

  // ── Selected route data ─────────────────────────────────────────────────────
  const selectedRoute  = routesWithScores[selectedRouteIdx] || routesWithScores[0]
  const onRouteReports = selectedRoute?.onRouteReports || []
  const monsoon        = isMonsoonSeason()

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* ════════════════ MAP ════════════════ */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={[startLoc.lat, startLoc.lng]}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Traffic tiles — ONLY shown when user turns on the Traffic toggle.
              The safety score ALWAYS deducts traffic penalties regardless.
              Toggling only changes what you SEE on the map. */}
          {showTraffic && (
            <>
              <TileLayer url={getTrafficTileUrl('relative')} opacity={0.5} zIndex={5} />
              <TileLayer url={getIncidentTileUrl()}          opacity={0.7} zIndex={6} />
            </>
          )}

          {/* CRIME HOTSPOT CIRCLES — NCRB 2022-2023 + The Telegraph + Times of India */}
          {showCrimes && CRIME_HOTSPOTS.map(hotspot => {
            const cfg = CRIME_SEVERITY_CONFIG[hotspot.severity] || CRIME_SEVERITY_CONFIG.low
            return (
              <Circle
                key={hotspot.id}
                center={[hotspot.lat, hotspot.lng]}
                radius={hotspot.radius}
                pathOptions={{ color: cfg.color, fillColor: cfg.fillColor, fillOpacity: cfg.fillOpacity, weight: 1.5, opacity: 0.7 }}
              >
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <p style={{ fontWeight: 900, fontSize: 11, color: cfg.color }}>{cfg.label} — {hotspot.area}</p>
                    <p style={{ fontSize: 10, color: '#737686', marginTop: 4 }}>{hotspot.description}</p>
                    <p style={{ fontSize: 9, color: '#a0a3b1', marginTop: 4 }}>Source: {hotspot.source}</p>
                  </div>
                </Popup>
              </Circle>
            )
          })}

          {/* FLOOD ZONE CIRCLES — ISRO/NRSC Flood Hazard Atlas + NDMA + CWC */}
          {showFloodRisk && FLOOD_ZONES_STATIC.map(zone => {
            const cfg = FLOOD_SEVERITY_CONFIG[zone.severity] || FLOOD_SEVERITY_CONFIG.low
            const livePoint = liveFloodData.find(p =>
              Math.abs(p.lat - zone.lat) < 0.5 && Math.abs(p.lng - zone.lng) < 1.0
            )
            return (
              <Circle
                key={zone.id}
                center={[zone.lat, zone.lng]}
                radius={zone.radius}
                pathOptions={{
                  color: cfg.color, fillColor: cfg.fillColor,
                  fillOpacity: monsoon && zone.monsoonRisk ? cfg.fillOpacity * 1.6 : cfg.fillOpacity,
                  weight: 1.5, opacity: 0.65,
                }}
              >
                <Popup>
                  <div style={{ minWidth: 170 }}>
                    <p style={{ fontWeight: 900, fontSize: 11, color: cfg.color }}>{cfg.label} — {zone.area}</p>
                    <p style={{ fontSize: 10, color: '#737686', marginTop: 4 }}>{zone.description}</p>
                    {livePoint && (
                      <p style={{ fontSize: 9, fontWeight: 700, color: cfg.color, marginTop: 4 }}>
                        Live: {livePoint.currentDischarge.toLocaleString()} m³/s · {livePoint.trend === 'rising' ? '↑ Rising' : '↓ Falling'}
                      </p>
                    )}
                    {monsoon && zone.monsoonRisk && (
                      <p style={{ fontSize: 9, fontWeight: 900, color: '#1D4ED8', marginTop: 2 }}>⚡ Monsoon risk active</p>
                    )}
                    <p style={{ fontSize: 9, color: '#a0a3b1', marginTop: 4 }}>Source: {zone.source}</p>
                  </div>
                </Popup>
              </Circle>
            )
          })}

          {destLoc && (
            <MapFit startLat={startLoc.lat} startLng={startLoc.lng} destLat={destLoc.lat} destLng={destLoc.lng} />
          )}


          {/* User & destination markers */}
          <Marker position={[startLoc.lat, startLoc.lng]} icon={userIcon} />
          <Marker position={[destLoc.lat, destLoc.lng]} icon={destIcon}>
            <Popup><div className="text-xs font-bold">{destination.name}</div></Popup>
          </Marker>

          {/* Route polylines — Google Maps style
              Unselected : thin grey dashed line, tap to switch
              Selected   : white outline (weight 11) UNDER colored segments (weight 7)
                           → gives crisp edges, no neon bleed from tile layer
                           → segments colored blue/amber/red from TomTom traffic data
          */}
          {routesWithScores.flatMap((route, idx) => {
            const isSelected = idx === selectedRouteIdx

            if (!isSelected) {
              return [
                <Polyline
                  key={`route-unsel-${idx}`}
                  positions={route.geometry}
                  pathOptions={{
                    color: '#64748b', weight: 4, opacity: 0.5,
                    dashArray: '6 8', lineCap: 'round', lineJoin: 'round',
                  }}
                  eventHandlers={{ click: () => setSelectedRouteIdx(idx) }}
                />
              ]
            }

            // Selected route — build colored traffic segments
            const segments = buildTrafficSegments(
              route.geometry,
              route.trafficSections || []
            )

            return [
              // 1. White outline — renders first (below), prevents tile bleed on edges
              <Polyline
                key={`route-outline-${idx}`}
                positions={route.geometry}
                pathOptions={{
                  color: 'white', weight: 11, opacity: 0.85,
                  lineCap: 'round', lineJoin: 'round',
                }}
                eventHandlers={{ click: () => setSelectedRouteIdx(idx) }}
              />,
              // 2. Colored segments on top — no className, no filter, no shadow
              ...segments.map((seg, segIdx) => (
                <Polyline
                  key={`route-seg-${idx}-${segIdx}`}
                  positions={seg.points}
                  pathOptions={{
                    color: seg.color, weight: 7, opacity: 1,
                    lineCap: 'round', lineJoin: 'round',
                  }}
                  eventHandlers={{ click: () => setSelectedRouteIdx(idx) }}
                />
              )),
            ]
          })}

          {/* ── Hazard warning pins ON selected route ── */}
          {onRouteReports.map(r => {
            const typeId = r.hazardType || r.type || 'other'
            const ht     = HAZARD_MAP[typeId] || { icon: 'warning', label: 'Hazard', color: '#737686' }
            const color  = SEVERITY_COLORS[r.severity] || SEVERITY_COLORS.default
            return (
              <Marker
                key={r.id}
                position={[r._snapLat, r._snapLng]}
                icon={createHazardPin(r.severity, ht.icon)}
              >
                <Popup>
                  <div style={{ minWidth: '150px', maxWidth: '200px' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="material-symbols-outlined icon-filled"
                        style={{ color: ht.color, fontSize: '14px' }}
                      >{ht.icon}</span>
                      <p className="font-black text-xs text-[#191c1e]">{ht.label}</p>
                    </div>
                    <span
                      className="text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase"
                      style={{ color, background: color + '22' }}
                    >{r.severity || 'medium'}</span>
                    {r.description && (
                      <p className="text-[10px] text-[#737686] mt-1 leading-relaxed">{r.description}</p>
                    )}
                    <p className="text-[9px] text-[#737686] mt-1">
                      ⚠️ -{r._penalty}pts · {timeAgo(r.createdAt || r.timestamp)}
                    </p>
                    {r.anonymous ? (
                      <p className="text-[9px] text-[#737686]">👤 Anonymous</p>
                    ) : r.userName ? (
                      <p className="text-[9px] text-[#737686]">👤 {r.userName}</p>
                    ) : null}
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      {/* ════ MAP OVERLAY TOGGLE BUTTONS ════
           Right side of map. Three pill toggles:
             🚨 Crime Zones  — shows/hides 26 crime circles from NCRB data
             🌊 Flood Risk   — shows/hides 15 ISRO/NDMA flood zones
             🚦 Traffic      — shows/hides live TomTom flow tiles
           Score penalties are ALWAYS active; toggles only control VISIBILITY.
      ══════════════════════════════════════════════════════ */}
      <div className="absolute bottom-[52%] right-3 z-20 flex flex-col gap-1.5 items-end">

        {/* ── Crime Zones Toggle ── */}
        <button
          onClick={() => setShowCrimes(c => !c)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shadow-lg border active:scale-95 transition-all"
          style={{
            background:  showCrimes ? '#EF4444' : 'rgba(255,255,255,0.93)',
            borderColor: showCrimes ? '#DC2626' : '#e2e5ec',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span className="material-symbols-outlined icon-filled"
            style={{ fontSize: 13, color: showCrimes ? 'white' : '#EF4444' }}>report</span>
          <span className="text-[10px] font-black tracking-wide"
            style={{ color: showCrimes ? 'white' : '#737686' }}>Crime Zones</span>
          {showCrimes && (
            <span style={{ fontSize: 9, fontWeight: 900, background: 'rgba(255,255,255,0.3)',
              color: 'white', padding: '0 4px', borderRadius: 99 }}>{CRIME_HOTSPOTS.length}</span>
          )}
        </button>

        {/* ── Flood Risk Toggle ── */}
        <button
          onClick={() => setShowFloodRisk(f => !f)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shadow-lg border active:scale-95 transition-all"
          style={{
            background:  showFloodRisk ? '#1D4ED8' : 'rgba(255,255,255,0.93)',
            borderColor: showFloodRisk ? '#1E40AF' : '#e2e5ec',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span className="material-symbols-outlined icon-filled"
            style={{ fontSize: 13, color: showFloodRisk ? 'white' : '#1D4ED8' }}>flood</span>
          <span className="text-[10px] font-black tracking-wide"
            style={{ color: showFloodRisk ? 'white' : '#737686' }}>
            Flood Risk{monsoon ? ' ⚡' : ''}
          </span>
          {floodLoading && (
            <span className="w-2 h-2 rounded-full border border-current animate-spin"
              style={{ borderTopColor: 'transparent', color: showFloodRisk ? 'white' : '#1D4ED8' }} />
          )}
        </button>

        {/* ── Traffic Toggle ── */}
        <button
          onClick={() => setShowTraffic(t => !t)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shadow-lg border active:scale-95 transition-all"
          style={{
            background:  showTraffic ? '#F59E0B' : 'rgba(255,255,255,0.93)',
            borderColor: showTraffic ? '#D97706' : '#e2e5ec',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span className="material-symbols-outlined icon-filled"
            style={{ fontSize: 13, color: showTraffic ? 'white' : '#F59E0B' }}>traffic</span>
          <span className="text-[10px] font-black tracking-wide"
            style={{ color: showTraffic ? 'white' : '#737686' }}>Traffic</span>
          {/* Live dot — always pulsing to indicate score is always factored */}
          <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
            style={{ background: showTraffic ? 'rgba(255,255,255,0.8)' : '#F59E0B' }} />
        </button>

        {/* ── Legend box — shown when any overlay is active ── */}
        {(showCrimes || showFloodRisk || showTraffic) && (
          <div className="flex flex-col gap-1 px-2.5 py-2 rounded-xl shadow-md"
            style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', border: '1px solid #e2e5ec' }}>
            {showCrimes && [
              { color: '#EF4444', label: 'High Crime (-18pts)' },
              { color: '#F59E0B', label: 'Medium Crime (-10pts)' },
              { color: '#FBBF24', label: 'Watch Area (-5pts)' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color, opacity: 0.75 }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#434655' }}>{label}</span>
              </div>
            ))}
            {showFloodRisk && [
              { color: '#1D4ED8', label: `High Flood (-${monsoon ? 28 : 20}pts)` },
              { color: '#0369A1', label: `Moderate (-${monsoon ? 14 : 10}pts)` },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color, opacity: 0.75 }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#434655' }}>{label}</span>
              </div>
            ))}
            {showTraffic && [
              { color: TRAFFIC_COLORS.heavy,    label: 'Heavy traffic (-15pts)' },
              { color: TRAFFIC_COLORS.moderate, label: 'Moderate (-8pts)' },
              { color: TRAFFIC_COLORS.clear,    label: 'Clear roads (no deduction)' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#434655' }}>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ════════════════ FLOATING HEADER ════════════════ */}
      <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3 md:w-[400px] md:left-4 md:top-4 md:px-0 md:pt-0">
        <div className="glass-panel rounded-2xl flex flex-col p-3 shadow-lg gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-xl bg-[#eceef0] flex items-center justify-center active:scale-90 transition-transform flex-shrink-0">
              <span className="material-symbols-outlined text-[#434655] text-[20px]">arrow_back</span>
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-black text-[#191c1e] truncate">Route Options</h1>
            </div>
            <div className="flex items-center gap-1 bg-[#10B981]/10 px-2 py-1 rounded-full flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              <span className="text-[10px] font-black text-[#10B981]">Live Safety</span>
            </div>
          </div>

          {/* From / To — both tappable to change ─────────────────── */}
          <div className="relative pl-3 mt-1">
            <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-[#c3c6d7] z-0" />

            {/* FROM field */}
            <button
              onClick={() => navigate('/search?type=start')}
              className="w-full flex items-center gap-3 relative z-10 bg-white/60 hover:bg-white/80 active:bg-white rounded-xl p-1.5 mb-1 text-left transition-colors"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6] shadow-[0_0_0_3px_rgba(0,74,198,0.2)] ml-0.5 flex-shrink-0" />
              <p className="text-xs font-semibold text-[#191c1e] truncate flex-1">
                {startLocation?.name || 'Your Current Location'}
              </p>
              <span className="material-symbols-outlined text-[#004ac6] flex-shrink-0" style={{ fontSize: '14px' }}>edit</span>
            </button>

            {/* TO field */}
            <button
              onClick={() => navigate('/search')}
              className="w-full flex items-center gap-3 relative z-10 bg-white/60 hover:bg-white/80 active:bg-white rounded-xl p-1.5 text-left transition-colors"
            >
              <div className="w-2.5 h-2.5 bg-[#EF4444] ml-0.5 flex-shrink-0" style={{ transform: 'rotate(45deg)' }} />
              <p className="text-xs font-semibold text-[#191c1e] truncate flex-1">
                {destination?.name || 'Select destination…'}
              </p>
              <span className="material-symbols-outlined text-[#EF4444] flex-shrink-0" style={{ fontSize: '14px' }}>edit</span>
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════ TRANSPORT MODE TABS ════════════════ */}
      <div className="absolute z-30 left-3 right-3 top-[138px] md:w-[400px] md:left-4 md:right-auto md:top-[160px]">
        <div className="glass-panel rounded-2xl p-1.5 shadow-lg border border-white/30 flex gap-1">
          {TRANSPORT_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition-all active:scale-95 ${
                transportMode === m.id ? 'text-white shadow-md' : 'text-[#737686] hover:bg-[#eceef0]'
              }`}
              style={transportMode === m.id ? { backgroundColor: m.color } : {}}
            >
              <span className="material-symbols-outlined icon-filled text-[16px]">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════ BOTTOM SHEET ════════════════ */}
      <div className="absolute left-0 right-0 bottom-16 z-20 md:w-[400px] md:left-4 md:right-auto md:bottom-4 md:top-[220px] md:flex md:flex-col">
        <div className="glass-panel rounded-t-3xl md:rounded-3xl shadow-2xl border border-white/30 md:flex-1 md:flex md:flex-col md:overflow-hidden">
          {/* Handle (mobile) */}
          <div className="flex flex-col items-center pt-3 pb-0 cursor-pointer md:hidden"
            onClick={() => setSheetOpen(o => !o)}>
            <div className="w-10 h-1 rounded-full bg-[#c3c6d7] mb-2" />
          </div>

          <div className="px-4 pb-4 md:flex-1 md:flex md:flex-col md:p-4 md:overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 mt-2 md:mt-0">
              <h2 className="text-base font-black text-[#191c1e]">Select Route</h2>
              {loading && <span className="material-symbols-outlined text-[#737686] text-[18px] animate-spin">refresh</span>}
            </div>

            {/* Route cards */}
            <div className={`space-y-2.5 max-h-[38vh] overflow-y-auto custom-scrollbar pr-1 mb-3 md:flex-1 md:max-h-none ${sheetOpen ? 'block' : 'hidden md:block'}`}>
              {routesWithScores.length === 0 && !loading && (
                <div className="text-center py-6">
                  <span className="material-symbols-outlined text-[#c3c6d7] text-[40px]">route</span>
                  <p className="text-sm text-[#737686] mt-2">Calculating routes…</p>
                </div>
              )}

              {routesWithScores.map((route, idx) => {
                // ── SINGLE SOURCE OF TRUTH ───────────────────────────────────
                // rankLabel/rankColor/recommended come from safetyScore.js
                // AFTER routes are sorted by score — never from a fixed array.
                const color        = route.rankColor   || '#004ac6'
                const name         = route.rankLabel   || 'Route'
                const isSelected   = selectedRouteIdx === idx
                const scoreInfo    = getScoreLabel(route.safetyScore || 75)
                const hazardCnt    = route.onRouteReports?.length || 0
                const trafficInfo  = getTrafficStatus(route)

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedRouteIdx(idx)}
                    className={`w-full flex flex-col p-3.5 rounded-2xl border-2 text-left transition-all duration-200 active:scale-[0.99] ${
                      isSelected ? 'bg-white shadow-md' : 'bg-[#f7f9fb] border-[#eceef0]'
                    }`}
                    style={isSelected ? { borderColor: color } : {}}
                  >
                    {/* Top row */}
                    <div className="flex justify-between items-center mb-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Route rank badge */}
                        <span className="text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider"
                          style={{ backgroundColor: color }}>{name}</span>

                        {/* Recommended pill */}
                        {route.recommended && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                            style={{ color: '#10B981', background: '#10B98115', border: '1px solid #10B98130' }}>
                            ✓ Recommended</span>
                        )}

                        {/* Compact penalty summary badges */}
                        {hazardCnt > 0 && (
                          <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                            style={{ background: '#EF444415', color: '#EF4444' }}>
                            <span className="material-symbols-outlined icon-filled" style={{ fontSize: 10 }}>warning</span>
                            {hazardCnt} report{hazardCnt > 1 ? 's' : ''}
                          </span>
                        )}
                        {(route.crimePenalty > 0) && (
                          <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                            style={{ background: '#EF444415', color: '#EF4444' }}>
                            <span className="material-symbols-outlined icon-filled" style={{ fontSize: 10 }}>report</span>
                            Crime -{route.crimePenalty}
                          </span>
                        )}
                        {(route.floodPenalty > 0) && (
                          <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                            style={{ background: '#1D4ED815', color: '#1D4ED8' }}>
                            <span className="material-symbols-outlined icon-filled" style={{ fontSize: 10 }}>flood</span>
                            Flood -{route.floodPenalty}
                          </span>
                        )}
                        {(route.trafficPenalty > 0) && (
                          <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                            style={{ background: '#F59E0B15', color: '#D97706' }}>
                            <span className="material-symbols-outlined icon-filled" style={{ fontSize: 10 }}>traffic</span>
                            Traffic -{route.trafficPenalty}
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-[#191c1e] leading-tight">{route.durationMin} min</p>
                        <p className="text-[10px] text-[#737686] font-medium">{route.distanceKm} km · {MODE_LABELS[route.mode]?.label || 'Drive'}</p>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="material-symbols-outlined icon-filled" style={{ fontSize: '9px', color: trafficInfo.color }}>{trafficInfo.icon}</span>
                          <span className="text-[9px] font-bold" style={{ color: trafficInfo.color }}>{trafficInfo.label}</span>
                        </div>
                      </div>
                    </div>

                    {/* Safety score bar */}
                    <div className="flex items-center gap-3 mb-2.5">
                      <div>
                        <p className="text-xl font-black leading-none" style={{ color }}>{route.safetyScore || 75}</p>
                        <p className="text-[8px] uppercase tracking-widest font-black mt-0.5" style={{ color }}>Safety</p>
                      </div>
                      <div className="flex-1 h-2 bg-[#eceef0] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${route.safetyScore || 75}%`, backgroundColor: color }} />
                      </div>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{ color: scoreInfo.color, backgroundColor: scoreInfo.color + '15' }}>
                        {scoreInfo.label}
                      </span>
                    </div>

                    {/* ── Why this score? accordion (all cards) ─────────────── */}
                    <div className="mb-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedRouteIdx(expandedRouteIdx === idx ? null : idx) }}
                        className="flex items-center gap-1.5 text-[10px] font-black transition-colors"
                        style={{ color: expandedRouteIdx === idx ? color : '#737686' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                          {expandedRouteIdx === idx ? 'expand_less' : 'expand_more'}
                        </span>
                        {expandedRouteIdx === idx ? '▲ Hide reasons' : '▼ Why this score?'}
                      </button>
                      {expandedRouteIdx === idx && (
                        <div className="mt-2 rounded-xl px-3 py-2.5 space-y-1.5"
                          style={{ background: '#10B98108', borderLeft: `3px solid ${color}40` }}>
                          {getScoreReasons(route.safetyScore || 75, route.rankLabel).map((reason, ri) => (
                            <div key={ri} className="flex items-start gap-2">
                              <span className="font-black flex-shrink-0" style={{ color: '#10B981', fontSize: 11 }}>✓</span>
                              <span className="text-[10px] text-[#434655]">{reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ══ SCORE BREAKDOWN PANEL — selected card only ══════════════════════
                        Shows exactly WHY the score was reduced: which crimes, which
                        flood zones, traffic level, and live community reports.
                        This is the key "why that much points cut?" feature.
                    ═══════════════════════════════════════════════════════════════════ */}
                    {isSelected && (route.crimePenalty > 0 || route.floodPenalty > 0 || route.trafficPenalty > 0 || hazardCnt > 0) && (
                      <div className="border-t border-[#f2f4f6] pt-2.5 mt-0.5 space-y-2.5">
                        <p className="text-[9px] font-black text-[#737686] uppercase tracking-wider">
                          📊 Why this score?
                        </p>

                        {/* ── Crime Zones affecting this route ── */}
                        {route.onRouteCrimes?.length > 0 && (
                          <div>
                            <p className="text-[9px] font-black text-[#EF4444] uppercase tracking-wider mb-1.5">
                              🚨 Crime Zones on Route
                            </p>
                            <div className="space-y-1">
                              {route.onRouteCrimes.slice(0, 3).map(c => (
                                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
                                  style={{ background: '#EF444408' }}>
                                  <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ background: CRIME_SEVERITY_CONFIG[c.severity]?.fillColor + '30' }}>
                                    <span className="material-symbols-outlined icon-filled"
                                      style={{ color: CRIME_SEVERITY_CONFIG[c.severity]?.color, fontSize: 11 }}>report</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black text-[#191c1e] truncate">{c.area}</p>
                                    <p className="text-[9px] text-[#737686] truncate">
                                      {c.crimeTypes?.slice(0, 2).join(', ').replace(/_/g, ' ')}
                                    </p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-[10px] font-black text-[#EF4444]">-{c._penalty}pts</p>
                                    <p className="text-[8px] text-[#a0a3b1] capitalize">{c.severity}</p>
                                  </div>
                                </div>
                              ))}
                              {route.onRouteCrimes.length > 3 && (
                                <p className="text-[9px] text-[#737686] font-semibold pl-1">
                                  + {route.onRouteCrimes.length - 3} more crime zones
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* ── Flood Zones affecting this route ── */}
                        {route.onRouteFlood?.length > 0 && (
                          <div>
                            <p className="text-[9px] font-black text-[#1D4ED8] uppercase tracking-wider mb-1.5">
                              🌊 Flood Zones on Route
                            </p>
                            <div className="space-y-1">
                              {route.onRouteFlood.slice(0, 2).map(z => (
                                <div key={z.id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
                                  style={{ background: '#1D4ED808' }}>
                                  <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ background: '#1D4ED820' }}>
                                    <span className="material-symbols-outlined icon-filled"
                                      style={{ color: '#1D4ED8', fontSize: 11 }}>flood</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black text-[#191c1e] truncate">{z.area}</p>
                                    <p className="text-[9px] text-[#737686]">
                                      {z.severity} risk{monsoon && z.monsoonRisk ? ' · ⚡ Monsoon active' : ''}
                                    </p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-[10px] font-black text-[#1D4ED8]">-{z._penalty}pts</p>
                                    <p className="text-[8px] text-[#a0a3b1]">ISRO/NDMA</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ── Traffic deduction ── */}
                        {route.trafficPenalty > 0 && (
                          <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
                            style={{ background: '#F59E0B08' }}>
                            <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ background: '#F59E0B20' }}>
                              <span className="material-symbols-outlined icon-filled"
                                style={{ color: '#D97706', fontSize: 11 }}>traffic</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-black text-[#191c1e]">{route.trafficInfo?.label}</p>
                              <p className="text-[9px] text-[#737686]">Congestion slows route, raises risk</p>
                            </div>
                            <p className="text-[10px] font-black text-[#D97706] flex-shrink-0">-{route.trafficPenalty}pts</p>
                          </div>
                        )}

                        {/* ── Live community reports ── */}
                        {hazardCnt > 0 && (
                          <div>
                            <p className="text-[9px] font-black text-[#737686] uppercase tracking-wider mb-1.5">
                              ⚠️ Live Reports on Route
                            </p>
                            <div className="space-y-1">
                              {route.onRouteReports.slice(0, 3).map(r => {
                                const typeId = r.hazardType || r.type || 'other'
                                const ht     = HAZARD_MAP[typeId] || { icon: 'warning', label: 'Hazard', color: '#737686' }
                                return (
                                  <div key={r.id} className="flex items-center gap-2">
                                    <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                                      style={{ background: ht.color + '18' }}>
                                      <span className="material-symbols-outlined icon-filled"
                                        style={{ color: ht.color, fontSize: 11 }}>{ht.icon}</span>
                                    </div>
                                    <p className="text-[10px] font-semibold text-[#191c1e] flex-1 truncate">{ht.label}</p>
                                    <span className="text-[9px] font-black text-[#EF4444] flex-shrink-0">-{r._penalty}pts</span>
                                    <span className="text-[9px] text-[#737686] flex-shrink-0">{timeAgo(r.createdAt || r.timestamp)}</span>
                                  </div>
                                )
                              })}
                              {hazardCnt > 3 && (
                                <p className="text-[9px] text-[#737686] font-semibold">+ {hazardCnt - 3} more reports</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Start Journey button */}
            <button
              onClick={handleStartJourney}
              disabled={routesWithScores.length === 0}
              className={`w-full h-13 py-3.5 rounded-2xl bg-[#004ac6] text-white font-black text-sm shadow-lg shadow-blue-300/30 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 mt-auto ${!sheetOpen ? 'hidden md:flex' : ''}`}
            >
              <span className="material-symbols-outlined icon-filled text-[20px]">navigation</span>
              Start {MODE_LABELS[transportMode]?.label || 'Journey'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
