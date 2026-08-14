/**
 * NavigationPage.jsx — Live GPS Navigation
 *
 * Replaces the fake timer with:
 *   1. navigator.geolocation.watchPosition() — real device GPS sensor
 *   2. Haversine proximity detection — advances instruction when user is
 *      within PROXIMITY_METERS of the next turn's start coordinate
 *   3. Snaps map to user's real position every GPS update
 *   4. Stops advancing naturally when user stops moving (GPS stays put)
 *   5. Hazard pins shown along the route for awareness
 *
 * Falls back gracefully if geolocation is denied — shows the route
 * starting from the stored user location and uses a slow timer.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../../context/store'
import { HAZARD_TYPES, SEVERITY_COLORS } from '../../constants'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ─── Config ────────────────────────────────────────────────────────────────────
const PROXIMITY_METERS = 40  // How close user must be to trigger next step

// ─── Haversine distance ────────────────────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R   = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const userNavIcon = L.divIcon({
  html: `<div style="position:relative;width:24px;height:24px;">
    <div style="width:24px;height:24px;border-radius:50%;background:#004ac6;border:3px solid white;box-shadow:0 0 0 8px rgba(0,74,198,0.18);"></div>
    <div style="position:absolute;top:50%;left:50%;width:40px;height:40px;border-radius:50%;background:rgba(0,74,198,0.10);transform:translate(-50%,-50%);animation:pulse 2s infinite;"></div>
  </div>`,
  className: '', iconSize: [24, 24], iconAnchor: [12, 12],
})

const destNavIcon = L.divIcon({
  html: `<div style="width:32px;height:32px;border-radius:50%;background:#10B981;border:3px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
    <span class="material-symbols-outlined icon-filled" style="color:white;font-size:16px;">flag</span>
  </div>`,
  className: '', iconSize: [32, 32], iconAnchor: [16, 16],
})

const createHazardPin = (severity, matIcon) => {
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.default
  return L.divIcon({
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px ${color}60;">
      <span class="material-symbols-outlined icon-filled" style="color:white;font-size:12px;">${matIcon || 'warning'}</span>
    </div>`,
    className: '', iconSize: [26, 26], iconAnchor: [13, 13],
  })
}

const HAZARD_MAP = Object.fromEntries(HAZARD_TYPES.map(h => [h.id, h]))

// ─── Map controller: pan to position ─────────────────────────────────────────
function NavController({ lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lng) map.panTo([lat, lng], { animate: true, duration: 0.5 })
  }, [lat, lng, map])
  return null
}

// ─── Helper: format distance ──────────────────────────────────────────────────
function fmtDist(m) {
  if (!m || m < 0) return '—'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

// ─── Helper: time ago for hazard popup ───────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return ''
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  const m = Math.floor((Date.now() - d.getTime()) / 60000)
  if (m < 1)  return 'Just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function NavigationPage() {
  const navigate = useNavigate()
  const {
    userLocation, startLocation, destination,
    routes, selectedRouteIdx,
    setIsNavigating, setJourneyComplete,
    setLiveUserLocation,
  } = useAppStore()

  const selectedRoute  = routes[selectedRouteIdx] || routes[0]
  const onRouteReports = selectedRoute?.onRouteReports || []

  // ── State ──────────────────────────────────────────────────────────────────
  const initLoc = startLocation || userLocation
  const [currentLat, setCurrentLat] = useState(parseFloat(initLoc.lat))
  const [currentLng, setCurrentLng] = useState(parseFloat(initLoc.lng || initLoc.lon))
  const [stepIdx,    setStepIdx]    = useState(0)
  const [elapsed,    setElapsed]    = useState(0)
  const [gpsMode,    setGpsMode]    = useState('acquiring') // 'acquiring' | 'live' | 'fallback'
  const [speed,      setSpeed]      = useState(null) // km/h from GPS

  const watchRef    = useRef(null)
  const fallbackRef = useRef(null)
  const prevPos     = useRef(null)

  // Build steps from route or use dummy
  const steps = selectedRoute?.steps?.length > 0
    ? selectedRoute.steps.map(s => ({
        ...s,
        distance: s.distance < 1000 ? `${Math.round(s.distance)} m` : `${(s.distance / 1000).toFixed(1)} km`,
      }))
    : [
        { instruction: 'Head north on College Road',              distance: '0.4 km', icon: 'north'      },
        { instruction: 'Turn right onto NH-12',                   distance: '1.2 km', icon: 'turn_right' },
        { instruction: 'Continue on Barasat-Krishnanagar Road',   distance: '3.5 km', icon: 'straight'   },
        { instruction: 'Turn left at Kalyani Expressway',         distance: '2.0 km', icon: 'turn_left'  },
        { instruction: 'Arrive at destination',                   distance: '0.1 km', icon: 'flag'       },
      ]

  // ── GPS route geometry for proximity detection ─────────────────────────────
  // Each geometry point maps roughly to a step waypoint.
  const geometry = selectedRoute?.geometry || []

  // ── GPS watcher ────────────────────────────────────────────────────────────
  const handlePosition = useCallback((pos) => {
    const lat = pos.coords.latitude
    const lng = pos.coords.longitude
    const spd = pos.coords.speed // m/s or null

    setCurrentLat(lat)
    setCurrentLng(lng)
    setLiveUserLocation({ lat, lng })
    setGpsMode('live')

    if (spd !== null) setSpeed(Math.round(spd * 3.6)) // convert m/s → km/h

    // Update elapsed using real movement distance
    if (prevPos.current) {
      const moved = haversineMeters(lat, lng, prevPos.current.lat, prevPos.current.lng)
      if (moved > 2) setElapsed(e => e + 1) // crude time proxy
    }
    prevPos.current = { lat, lng }
  }, [setLiveUserLocation])

  // Distance to destination
  const distToDest = destination
    ? haversineMeters(currentLat, currentLng, parseFloat(destination.lat), parseFloat(destination.lng || destination.lon))
    : null

  // ── Arrive handler ────────────────────────────────────────────────────────
  const handleArrived = useCallback(() => {
    if (watchRef.current    !== null) navigator.geolocation.clearWatch(watchRef.current)
    if (fallbackRef.current !== null) clearInterval(fallbackRef.current)
    setLiveUserLocation(null)
    setIsNavigating(false)
    setJourneyComplete(true)
    navigate('/review')
  }, [navigate, setLiveUserLocation, setIsNavigating, setJourneyComplete])

  // ── Proximity detection: advance step when near next waypoint ──────────────
  useEffect(() => {
    if (!currentLat || !currentLng) return
    if (geometry.length > 1 && stepIdx < steps.length - 1) {
      const targetIdx = Math.round(((stepIdx + 1) / steps.length) * (geometry.length - 1))
      const [wLat, wLng] = geometry[Math.min(targetIdx, geometry.length - 1)]
      const dist = haversineMeters(currentLat, currentLng, wLat, wLng)

      if (dist <= PROXIMITY_METERS) {
        setStepIdx(s => Math.min(s + 1, steps.length - 1))
      }
    }
    
    if (distToDest !== null && distToDest < 50 && stepIdx === steps.length - 1) {
      handleArrived()
    }
  }, [currentLat, currentLng, geometry, stepIdx, steps.length, distToDest, handleArrived])

  const handleGpsError = useCallback(() => {
    setGpsMode('fallback')
    // Fallback: very slow simulated steps (every 45s)
    fallbackRef.current = setInterval(() => {
      setElapsed(e => {
        const newE = e + 1
        if (newE % 45 === 0) setStepIdx(s => Math.min(s + 1, steps.length - 1))
        return newE
      })
    }, 1000)
  }, [steps.length])

  useEffect(() => {
    if (!navigator.geolocation) {
      handleGpsError()
      return
    }

    navigator.geolocation.getCurrentPosition(handlePosition, handleGpsError, {
      enableHighAccuracy: true,
      timeout: 8000,
    })

    watchRef.current = navigator.geolocation.watchPosition(handlePosition, handleGpsError, {
      enableHighAccuracy: true,
      maximumAge:         2000,
      timeout:            10000,
    })

    return () => {
      if (watchRef.current    !== null) navigator.geolocation.clearWatch(watchRef.current)
      if (fallbackRef.current !== null) clearInterval(fallbackRef.current)
      setLiveUserLocation(null)
    }
  }, []) // intentionally empty — only run on mount/unmount

  // ── Derive display values ──────────────────────────────────────────────────
  const currentStep  = steps[stepIdx] || steps[steps.length - 1]
  const durationSec  = selectedRoute ? (selectedRoute.durationMin || 14) * 60 : 840
  const remainingMin = Math.max(0, Math.round((durationSec - elapsed * 12) / 60))
  const progressPct  = Math.min(100, (stepIdx / Math.max(steps.length - 1, 1)) * 100)

  // Compute ETA arrival clock: now + remainingMin
  const arrivalTime = (() => {
    const d = new Date()
    d.setMinutes(d.getMinutes() + remainingMin)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })()

  // Hazard within 300m of current position
  const hazardNearby = onRouteReports.some(r => {
    if (!r._snapLat || !r._snapLng) return false
    return haversineMeters(currentLat, currentLng, r._snapLat, r._snapLng) < 300
  })


  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* ════════ MAP ════════ */}
      <MapContainer
        center={[currentLat, currentLng]}
        zoom={16}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <NavController lat={currentLat} lng={currentLng} />

        {/* User dot */}
        <Marker position={[currentLat, currentLng]} icon={userNavIcon} />

        {/* Destination flag */}
        {destination && (
          <Marker
            position={[parseFloat(destination.lat), parseFloat(destination.lng || destination.lon)]}
            icon={destNavIcon}
          />
        )}

        {/* Route polyline — shadow underneath for depth */}
        {selectedRoute?.geometry && (
          <>
            <Polyline
              positions={selectedRoute.geometry}
              pathOptions={{ color: 'white', weight: 10, opacity: 0.25 }}
            />
            <Polyline
              positions={selectedRoute.geometry}
              pathOptions={{ color: '#004ac6', weight: 7, opacity: 0.9 }}
            />
          </>
        )}

        {/* Hazard warning pins on route */}
        {onRouteReports.map(r => {
          const typeId = r.hazardType || r.type || 'other'
          const ht     = HAZARD_MAP[typeId] || { icon: 'warning', label: 'Hazard', color: '#737686' }
          return (
            <Marker
              key={r.id}
              position={[r._snapLat, r._snapLng]}
              icon={createHazardPin(r.severity, ht.icon)}
            />
          )
        })}
      </MapContainer>

      {/* ════════ TOP INSTRUCTION CARD ════════ */}
      <div className="absolute top-0 left-0 right-0 z-30 p-3">
        <div className="glass-panel rounded-2xl p-4 shadow-xl border border-white/30">
          {/* GPS status bar */}
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              gpsMode === 'live'       ? 'bg-[#10B981] animate-pulse' :
              gpsMode === 'acquiring'  ? 'bg-[#F59E0B] animate-pulse' :
                                         'bg-[#737686]'
            }`} />
            <span className="text-[9px] font-black text-[#737686] uppercase tracking-wider">
              {gpsMode === 'live'      ? 'Live GPS Tracking Active' :
               gpsMode === 'acquiring' ? 'Acquiring GPS Signal…'    :
                                          'GPS Unavailable — Estimated'}
            </span>
            {speed !== null && gpsMode === 'live' && (
              <span className="ml-auto text-[9px] font-black text-[#004ac6]">{speed} km/h</span>
            )}
          </div>

          {/* Current step — bigger icon + bolder text */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: currentStep.icon === 'turn_left'  ? '#F59E0B' :
                            currentStep.icon === 'turn_right' ? '#004ac6' :
                            currentStep.icon === 'flag'       ? '#10B981' : '#004ac6',
              }}
            >
              <span className="material-symbols-outlined text-white text-[32px] icon-filled">
                {currentStep.icon}
              </span>
            </div>
            <div className="flex-1">
              <p className="text-lg font-black text-[#191c1e] leading-tight">
                {currentStep.instruction}
              </p>
              <div className="mt-1.5 inline-flex items-center gap-1.5 bg-[#004ac6]/10 px-2.5 py-1 rounded-full">
                <span className="material-symbols-outlined text-[#004ac6] icon-filled" style={{ fontSize: 12 }}>near_me</span>
                <span className="text-[10px] font-bold text-[#004ac6]">{currentStep.distance} ahead</span>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 bg-[#eceef0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#004ac6] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-[#737686] font-medium">Start</span>
            <span className="text-[9px] text-[#737686] font-medium">{destination?.name}</span>
          </div>
        </div>
      </div>

      {/* ════════ REMAINING DISTANCE PILL ════════ */}
      {distToDest !== null && (
        <div className="absolute z-30 left-0 right-0 flex justify-center" style={{ top: 'calc(var(--instruction-card-h, 180px) + 8px)' }}>
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg"
            style={{ background: 'rgba(0,74,198,0.9)', backdropFilter: 'blur(12px)' }}
          >
            <span className="material-symbols-outlined icon-filled text-white" style={{ fontSize: 14 }}>route</span>
            <span className="text-xs font-black text-white">
              {fmtDist(distToDest)} remaining to {destination?.name?.split(',')[0]}
            </span>
          </div>
        </div>
      )}

      {/* ════════ HAZARD ALERT STRIP ════════ */}
      {onRouteReports.length > 0 && (
        <div className="absolute top-[158px] left-3 right-3 z-30">
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center gap-2 border border-[#EF4444]/20 shadow-sm">
            <span className="material-symbols-outlined text-[#EF4444] icon-filled text-[16px] flex-shrink-0">warning</span>
            <p className="text-[10px] font-bold text-[#191c1e]">
              {onRouteReports.length} communit{onRouteReports.length === 1 ? 'y report' : 'y reports'} ahead on this route — stay alert
            </p>
          </div>
        </div>
      )}

      {/* ════════ HAZARD AHEAD BANNER (proximity < 300m) ════════ */}
      {hazardNearby && (
        <div className="absolute bottom-40 left-4 right-4 z-30 flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl animate-pulse"
          style={{ background: '#EF4444', boxShadow: '0 8px 24px rgba(239,68,68,0.4)' }}>
          <span className="material-symbols-outlined icon-filled text-white" style={{ fontSize: 22 }}>warning</span>
          <div>
            <p className="text-white font-black text-sm leading-tight">⚠️ HAZARD AHEAD</p>
            <p className="text-white/80 text-xs">Community hazard reported within 300m — stay alert</p>
          </div>
        </div>
      )}

      {/* ════════ BOTTOM STATS ════════ */}
      <div className="absolute bottom-0 left-0 right-0 z-30 px-3 pb-1">
        <div className="glass-panel rounded-2xl p-4 shadow-xl border border-white/30">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'ETA',      value: `${remainingMin} min`, sub: arrivalTime,                      icon: 'schedule',  color: '#004ac6' },
              { label: 'Distance', value: distToDest !== null ? fmtDist(distToDest) : `${selectedRoute?.distanceKm || '—'} km`, icon: 'route', color: '#10B981' },
              { label: 'Safety',   value: `${selectedRoute?.safetyScore || 82}`,                        icon: 'shield',    color: '#10B981' },
            ].map(s => (
              <div key={s.label} className="bg-[#f7f9fb] rounded-xl p-2.5 text-center">
                <span className="material-symbols-outlined icon-filled text-[18px]" style={{ color: s.color }}>{s.icon}</span>
                <p className="text-base font-black text-[#191c1e] mt-0.5 leading-tight">{s.value}</p>
                {s.sub && <p className="text-[9px] font-bold text-[#004ac6]">{s.sub}</p>}
                <p className="text-[9px] font-bold text-[#737686] uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setIsNavigating(false); navigate(-1) }}
              className="flex-1 h-11 rounded-xl border-2 border-[#c3c6d7] text-[#434655] font-semibold text-sm active:scale-95 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleArrived}
              className="flex-1 h-11 rounded-xl bg-[#10B981] text-white font-bold shadow-lg shadow-green-300/30 active:scale-95 transition-all flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[18px] icon-filled">check_circle</span>
              I've Arrived
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
