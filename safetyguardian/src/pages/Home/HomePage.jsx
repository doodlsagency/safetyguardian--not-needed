import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebase/firebase.js";
import { useEffect, useRef, useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../../context/store'
import { searchPlaces } from '../../services/nominatim'
import { fetchNearbyPlaces, formatNearbyDistance } from '../../services/overpass'
import { calculateSafetyScore, getScoreLabel } from '../../services/safetyScore'
import { getCurrentLocation } from '../../services/location'
import { DEFAULT_CENTER } from '../../constants'
import WeatherCard from '../../components/WeatherCard'
import { getWeather } from '../../services/weather'

// ── Fix Leaflet default icons ─────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const createColorIcon = (color, icon) => L.divIcon({
  html: `<div style="width:36px;height:36px;border-radius:50%;background:white;border:2.5px solid ${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.2);">
    <span class="material-symbols-outlined icon-filled" style="color:${color};font-size:18px;">${icon}</span>
  </div>`,
  className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -22],
})

const userIcon = L.divIcon({
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#004ac6;border:3px solid white;box-shadow:0 0 0 5px rgba(0,74,198,0.2);"></div>`,
  className: '', iconSize: [20, 20], iconAnchor: [10, 10],
})

const createFriendIcon = (name) => L.divIcon({
  className: '',
  html: `<div style="position:relative;">
    <div style="width:40px;height:40px;border-radius:50%;border:3px solid #8B5CF6;background:linear-gradient(135deg,#a78bfa,#7c3aed);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(139,92,246,0.45);font-size:16px;color:white;font-weight:900;">
      ${(name || '?')[0].toUpperCase()}
    </div>
    <div style="position:absolute;bottom:-2px;right:-2px;width:12px;height:12px;background:#10B981;border:2px solid white;border-radius:50%;"></div>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
})

function MapController({ center, zoom }) {
  const map = useMap()
  useEffect(() => { if (center) map.setView(center, zoom, { animate: true, duration: 0.6 }) }, [center, zoom, map])
  return null
}

function MapRefCapture({ mapRef }) {
  const map = useMap()
  useEffect(() => { mapRef.current = map }, [map, mapRef])
  return null
}

const AMENITY_CFG = {
  hospital:     { color: '#EF4444', icon: 'local_hospital'        },
  clinic:       { color: '#F87171', icon: 'medical_services'      },
  police:       { color: '#004ac6', icon: 'local_police'          },
  fire_station: { color: '#F59E0B', icon: 'local_fire_department' },
  pharmacy:     { color: '#10B981', icon: 'local_pharmacy'        },
  fuel:         { color: '#737686', icon: 'local_gas_station'     },
  parking:      { color: '#6366F1', icon: 'local_parking'         },
  atm:          { color: '#8B5CF6', icon: 'atm'                   },
  restaurant:   { color: '#F59E0B', icon: 'restaurant'            },
  fast_food:    { color: '#EF4444', icon: 'fastfood'              },
  hotel:        { color: '#7C3AED', icon: 'hotel'                 },
  Mechanic:     { color: '#EA580C', icon: 'build'                 },
  'Tyre Shop':  { color: '#78716C', icon: 'tire_repair'           },
  'EV Charging':{ color: '#22C55E', icon: 'ev_station'            },
  'Bike Repair':{ color: '#F59E0B', icon: 'pedal_bike'            },
  'Bike Shop':  { color: '#EA580C', icon: 'directions_bike'       },
  'Bus Stop':   { color: '#F59E0B', icon: 'directions_bus'        },
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function HomePage() {
  const navigate = useNavigate()
  const {
    user,
    userName,
    userLocation,
    setUserLocation,
    nearbyPlaces,
    setNearbyPlaces,
    safetyScore,
    setSafetyScore,
    setDestination,
    reports,
    setReports,
    setIsLoggedIn,
    setHasPermissions,
    setEmergencyContacts,
    prefs,
  } = useAppStore()

  const [searchQuery, setSearchQuery]       = useState('')
  const [suggestions, setSuggestions]       = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingPlaces, setLoadingPlaces]   = useState(false)
  const [locating, setLocating]             = useState(true)
  const [liveUsers, setLiveUsers]           = useState([])   // real-time people near me
  const [mapCenter, setMapCenter]           = useState(DEFAULT_CENTER)
  const [sheetState, setSheetState]         = useState('peek')
  const [showMenu, setShowMenu]             = useState(false)
  const [weather, setWeather]               = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [weatherError, setWeatherError]     = useState(null)
  const [isListening, setIsListening]       = useState(false)
  const [speechError, setSpeechError]       = useState('')

  const debounceRef = useRef(null)
  const mapRef      = useRef(null)
  const recognitionRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-IN'

    recognition.onstart = () => {
      setIsListening(true)
      setSpeechError('')
    }
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      handleSearchChange(transcript)
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setSpeechError('Microphone permission denied.')
      } else {
        setSpeechError('Could not hear you. Try again.')
      }
      setIsListening(false)
    }
    recognition.onend = () => {
      setIsListening(false)
    }
    recognitionRef.current = recognition
  }, [])

  const startVoiceSearch = () => {
    if (!recognitionRef.current) {
      alert('Voice search is not supported in this browser.')
      return
    }
    if (isListening) {
      recognitionRef.current.stop()
    } else {
      try {
        recognitionRef.current.start()
      } catch (err) {
        console.error(err)
      }
    }
  }
  const menuRef     = useRef(null)

  // ── Load nearby places (inside component so it can access state setters) ──
  const loadNearby = useCallback(async (lat, lng) => {
    setLoadingPlaces(true)
    try {
      const places = await fetchNearbyPlaces(lat, lng, 3000)
      setNearbyPlaces(places)
      setSafetyScore(calculateSafetyScore({ nearbyPlaces: places, reports }))
    } catch {
      const demo = [
        { id: 1, lat: lat + 0.008, lng: lng + 0.012, name: 'Barasat District Hospital', amenity: 'hospital', distance: 850 },
        { id: 2, lat: lat - 0.009, lng: lng + 0.015, name: 'Barasat Police Station', amenity: 'police', distance: 1100 },
        { id: 3, lat: lat + 0.015, lng: lng - 0.008, name: 'Barasat Fire Station', amenity: 'fire_station', distance: 1600 },
        { id: 4, lat: lat - 0.005, lng: lng - 0.010, name: 'Apollo Pharmacy', amenity: 'pharmacy', distance: 400 },
        { id: 5, lat: lat + 0.003, lng: lng + 0.007, name: 'HP Petrol Pump', amenity: 'fuel', distance: 600 },
      ]
      setNearbyPlaces(demo)
      setSafetyScore(calculateSafetyScore({ nearbyPlaces: demo, reports }))
    } finally {
      setLoadingPlaces(false)
    }
  }, [setNearbyPlaces, setSafetyScore, reports])

  // ── High-accuracy continuous GPS ─────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setLocating(false); return }
    setLocating(true)
    let nearbyLoaded = false

    const onSuccess = (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords
      setUserLocation({ lat, lng, accuracy, simulated: false })
      setMapCenter([lat, lng])
      setLocating(false)
      if (!nearbyLoaded) { nearbyLoaded = true; loadNearby(lat, lng) }
    }

    const onError = () => setLocating(false)
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }

    navigator.geolocation.getCurrentPosition(onSuccess, onError, opts)
    const watchId = navigator.geolocation.watchPosition(onSuccess, onError, opts)
    return () => navigator.geolocation.clearWatch(watchId)
  }, [setUserLocation, loadNearby])

  // ── Weather once GPS resolves ─────────────────────────────────────────────
  useEffect(() => {
    if (!userLocation?.lat || !userLocation?.lng || locating) return
    setWeatherLoading(true)
    setWeatherError(null)
    getWeather(userLocation.lat, userLocation.lng)
      .then(data => { setWeather(data); setWeatherLoading(false) })
      .catch(() => { setWeatherError('Unable to load weather'); setWeatherLoading(false) })
  }, [userLocation?.lat, userLocation?.lng, locating])

  // ── Firestore: subscribe to community reports ─────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'reports'),
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        setReports(data)
      },
      (err) => console.error('Firestore reports error:', err)
    )
    return () => unsub()
  }, [setReports])

  // ── Firestore: subscribe to live_locations (People Near Me) ──────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'live_locations'),
      (snapshot) => {
        const uid = auth.currentUser?.uid
        const users = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.id !== uid && u.lat && u.lng)
        setLiveUsers(users)
      },
      (err) => console.warn('[LiveUsers] error:', err)
    )
    return () => unsub()
  }, [])

  // ── Publish own GPS to Firestore when Live Friend Tracking is ON ──────────
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!prefs?.liveFriendTracking) {
      if (uid) deleteDoc(doc(db, 'live_locations', uid)).catch(() => {})
      return
    }
    if (!userLocation?.lat || !userLocation?.lng || !uid) return

    const displayName = auth.currentUser?.displayName || user?.name || 'Anonymous'

    const publish = () => setDoc(doc(db, 'live_locations', uid), {
      lat: userLocation.lat,
      lng: userLocation.lng,
      name: displayName,
      updatedAt: serverTimestamp(),
    }).catch(() => {})

    publish()
    const interval = setInterval(publish, 10000)
    return () => {
      clearInterval(interval)
      deleteDoc(doc(db, 'live_locations', uid)).catch(() => {})
    }
  }, [prefs?.liveFriendTracking, userLocation?.lat, userLocation?.lng, user?.name])

  // ── Search with debounce ──────────────────────────────────────────────────
  const handleSearchChange = (val) => {
    setSearchQuery(val)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setSuggestions([]); setShowSuggestions(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(val)
        setSuggestions(results)
        setShowSuggestions(true)
      } catch { setSuggestions([]) }
    }, 400)
  }

  const handleSelectSuggestion = (place) => {
    setDestination(place)
    setSearchQuery(place.name)
    setShowSuggestions(false)
    setSuggestions([])
    navigate('/routes')
  }

  const scoreInfo = getScoreLabel(safetyScore)
  const sheetHeights = { peek: '180px', half: '50vh', full: '80vh' }

  // ── Hamburger menu ────────────────────────────────────────────────────────
  const MENU_ITEMS = [
    { icon: 'home',       label: 'Home',     path: '/',        color: '#004ac6' },
    { icon: 'navigation', label: 'Journey',  path: '/search',  color: '#10B981' },
    { icon: 'flag',       label: 'Reports',  path: '/reports', color: '#F59E0B' },
    { icon: 'security',   label: 'Safety',   path: '/safety',  color: '#7C3AED' },
    { icon: 'person',     label: 'Profile',  path: '/profile', color: '#737686' },
  ]

  const handleLogout = () => {
    setIsLoggedIn(false)
    setHasPermissions(false)
    setEmergencyContacts([])
    setShowMenu(false)
    setTimeout(() => navigate('/login'), 50)
  }

  // Close drawer on outside tap
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
    }
    document.addEventListener('pointerup', handler)
    return () => document.removeEventListener('pointerup', handler)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full overflow-hidden bg-gray-100">

      {/* ══ MAP — full-screen background ══ */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={mapCenter}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          <MapController center={mapCenter} zoom={14} />
          <MapRefCapture mapRef={mapRef} />

          {/* Your location dot */}
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>
              <div className="text-xs font-bold">
                {userLocation.simulated ? '📍 Brainware University (GPS unavailable)' : '📍 Your Location'}
              </div>
            </Popup>
          </Marker>

          {/* Live friends — real-time from Firestore */}
          {liveUsers.map(u => (
            <Marker key={u.id} position={[u.lat, u.lng]} icon={createFriendIcon(u.name)}>
              <Popup>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>
                  🟢 {u.name} is sharing live location
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Safety radius circle */}
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={300}
            pathOptions={{ color: '#004ac6', fillColor: '#004ac6', fillOpacity: 0.07, weight: 1, opacity: 0.3 }}
          />

          {/* Nearby place markers */}
          {nearbyPlaces.slice(0, 20).map(p => {
            const cfg = AMENITY_CFG[p.amenity] || { color: '#737686', icon: 'place' }
            return (
              <Marker key={p.id} position={[p.lat, p.lng]} icon={createColorIcon(cfg.color, cfg.icon)}>
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold text-[#191c1e]">{p.name}</p>
                    <p className="text-[#737686] capitalize">{p.amenity?.replace(/_/g, ' ')} · {formatNearbyDistance(p.distance)}</p>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      {/* ══ HAMBURGER DRAWER ══ */}
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        .drawer-enter { animation: slideInLeft 0.25s cubic-bezier(0.4,0,0.2,1) both; }
      `}</style>

      {showMenu && (
        <div className="fixed inset-0 z-[999]" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}>
          <div
            ref={menuRef}
            className="drawer-enter absolute top-0 left-0 h-full bg-white flex flex-col shadow-2xl"
            style={{ width: 'min(300px, 82vw)' }}
          >
            <div className="flex items-center gap-3 px-5 pt-12 pb-5" style={{ background: 'linear-gradient(135deg, #004ac6, #1a73e8)' }}>
              <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border-2 border-white/40" style={{ background: '#ffffff30' }}>
                {user?.avatar
                  ? <img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />
                  : <span className="w-full h-full flex items-center justify-center text-white font-black text-base">
                      {(user?.name || 'U').trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black text-sm truncate">{user?.name || 'Guardian'}</p>
                <p className="text-white/70 text-[11px] truncate">{user?.email || ''}</p>
              </div>
              <button onClick={() => setShowMenu(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,255,255,0.18)' }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3">
              {MENU_ITEMS.map((item, i) => (
                <button
                  key={item.label}
                  onClick={() => { setShowMenu(false); setTimeout(() => navigate(item.path), 50) }}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-[#f7f9fb] active:bg-[#eef2ff] transition-colors"
                  style={{ borderBottom: i < MENU_ITEMS.length - 1 ? '1px solid #f2f4f6' : 'none' }}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: item.color + '15' }}>
                    <span className="material-symbols-outlined icon-filled" style={{ color: item.color, fontSize: '19px' }}>{item.icon}</span>
                  </div>
                  <span className="text-sm font-semibold text-[#191c1e]">{item.label}</span>
                  <span className="material-symbols-outlined text-[#c3c6d7] ml-auto" style={{ fontSize: '16px' }}>chevron_right</span>
                </button>
              ))}
            </div>

            <div className="px-4 pb-8 pt-2 border-t border-[#f0f2f5]">
              <button onClick={handleLogout}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl hover:bg-[#FEF2F2] transition-colors">
                <div className="w-9 h-9 rounded-xl bg-[#FEF2F2] flex items-center justify-center">
                  <span className="material-symbols-outlined icon-filled text-[#EF4444]" style={{ fontSize: '19px' }}>logout</span>
                </div>
                <span className="text-sm font-semibold text-[#EF4444]">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ FLOATING HEADER (top) ══ */}
      <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3 space-y-2">
        {/* Top bar */}
        <div className="glass-panel rounded-2xl flex items-center px-4 py-2.5 shadow-lg gap-3">
          <button
            onClick={() => setShowMenu(s => !s)}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
            style={{ background: '#004ac6' }}
          >
            <span className="material-symbols-outlined text-white" style={{ fontSize: '20px' }}>menu</span>
          </button>
          <h1 className="font-black text-[15px] text-[#191c1e] tracking-tight flex-1">Safety Guardian</h1>

          {locating ? (
            <div className="flex items-center gap-1.5 bg-[#004ac6]/10 px-2.5 py-1 rounded-full">
              <span className="material-symbols-outlined text-[#004ac6] text-[14px] animate-spin">refresh</span>
              <span className="text-[10px] font-bold text-[#004ac6]">Locating…</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-[#10B981]/10 px-2.5 py-1 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              <span className="text-[10px] font-bold text-[#10B981]">
                {userLocation.simulated ? 'Demo GPS' : 'GPS Active'}
              </span>
            </div>
          )}

          <button onClick={() => navigate('/profile')}
            className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 active:scale-90 transition-transform border-2 border-white/50"
            style={{ background: '#004ac6' }}>
            {user?.avatar
              ? <img src={user.avatar} alt="profile" className="w-full h-full object-cover" />
              : user?.name
                ? <span className="w-full h-full flex items-center justify-center text-white text-[11px] font-black">
                    {user.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                : <span className="material-symbols-outlined text-white icon-filled" style={{ fontSize: '16px' }}>person</span>
            }
          </button>
        </div>

        {/* Search bar */}
        <div className="relative">
          <div className="glass-panel rounded-2xl flex items-center gap-3 px-4 py-3 shadow-lg border border-white/40 focus-within:border-[#004ac6]/40 transition-colors">
            <span className="material-symbols-outlined text-[#004ac6] text-[20px]">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => setSheetState('peek')}
              placeholder="Search Kolkata, Howrah, Siliguri…"
              className="flex-1 bg-transparent outline-none text-sm text-[#191c1e] placeholder:text-[#737686]"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSuggestions([]); setShowSuggestions(false) }}>
                <span className="material-symbols-outlined text-[#737686] text-[20px]">close</span>
              </button>
            )}
            <button onClick={startVoiceSearch} title="Voice search">
              <span 
                className={`material-symbols-outlined text-[20px] ${isListening ? 'animate-pulse icon-filled' : ''}`}
                style={{ color: isListening ? '#EF4444' : '#004ac6' }}
              >
                {isListening ? 'mic' : 'mic_none'}
              </span>
            </button>
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 glass-panel rounded-2xl shadow-xl border border-white/40 max-h-56 overflow-y-auto custom-scrollbar animate-fade-in z-40">
              {suggestions.map(s => (
                <button key={s.id} onClick={() => handleSelectSuggestion(s)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#004ac6]/5 transition-colors border-b border-[#eceef0]/60 last:border-0 text-left">
                  <span className="material-symbols-outlined text-[#004ac6] text-[18px]">place</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#191c1e] truncate">{s.name}</p>
                    <p className="text-xs text-[#737686] truncate">{s.displayName}</p>
                  </div>
                  <span className="material-symbols-outlined text-[#737686] text-[14px]">arrow_forward_ios</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══ WEATHER CARD (floating right) ══ */}
      <div className="absolute z-20 animate-fade-in" style={{ top: '130px', right: '12px', maxWidth: '190px' }}>
        <WeatherCard weather={weather} loading={weatherLoading} error={weatherError} />
      </div>

      {/* ══ MAP ZOOM CONTROLS ══ */}
      <div className="absolute z-20 flex flex-col gap-1.5" style={{ top: '320px', right: '12px' }}>
        <button
          onClick={() => { const m = mapRef.current; if (m) m.zoomIn(1, { animate: true }) }}
          className="glass-panel w-10 h-10 rounded-xl flex items-center justify-center shadow-md border border-white/30 active:scale-90 transition-transform hover:bg-white/80"
          title="Zoom in"
        >
          <span className="material-symbols-outlined text-[20px] font-bold">add</span>
        </button>
        <button
          onClick={() => { const m = mapRef.current; if (m) m.zoomOut(1, { animate: true }) }}
          className="glass-panel w-10 h-10 rounded-xl flex items-center justify-center shadow-md border border-white/30 active:scale-90 transition-transform hover:bg-white/80"
          title="Zoom out"
        >
          <span className="material-symbols-outlined text-[20px] font-bold">remove</span>
        </button>
        <button
          onClick={() => {
            const m = mapRef.current
            if (m) m.flyTo([userLocation.lat, userLocation.lng], 16, { animate: true, duration: 0.8 })
            else setMapCenter([userLocation.lat, userLocation.lng])
          }}
          className="glass-panel w-10 h-10 rounded-xl flex items-center justify-center shadow-md border border-white/30 active:scale-90 transition-transform"
          title="My location"
        >
          <span className="material-symbols-outlined text-[#004ac6] icon-filled text-[20px]">my_location</span>
        </button>

        {/* Live tracking indicator */}
        {prefs?.liveFriendTracking && (
          <div className="glass-panel w-10 h-10 rounded-xl flex items-center justify-center shadow-md border border-[#8B5CF6]/30" title="Live tracking ON">
            <span className="material-symbols-outlined icon-filled text-[18px]" style={{ color: '#8B5CF6' }}>group</span>
          </div>
        )}
      </div>

      {/* ══ BOTTOM SHEET ══ */}
      <div
        className="absolute left-0 right-0 z-20 transition-all duration-300 ease-in-out md:left-6 md:right-auto md:w-[400px] md:bottom-28 md:top-[150px] md:h-auto md:flex md:flex-col"
        style={{ bottom: '80px', height: window.innerWidth >= 768 ? 'auto' : sheetHeights[sheetState] }}
      >
        <div className="glass-panel h-full rounded-t-3xl md:rounded-3xl shadow-2xl border border-white/30 flex flex-col overflow-hidden">
          {/* Drag handle */}
          <div
            className="flex-shrink-0 flex flex-col items-center pt-3 pb-2 cursor-pointer md:hidden"
            onClick={() => setSheetState(s => s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek')}
          >
            <div className="w-10 h-1 rounded-full bg-[#c3c6d7]" />
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-3">

            {/* Route Analysis Preview */}
            <div className="bg-white rounded-2xl p-3.5 mb-3 shadow-sm border border-[#eceef0]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#004ac6] icon-filled text-[18px]">route</span>
                  <span className="font-black text-sm text-[#191c1e]">Route Analysis</span>
                </div>
                <button onClick={() => navigate('/search')}
                  className="text-xs font-bold text-[#004ac6] bg-[#004ac6]/10 px-3 py-1 rounded-full active:scale-95 transition-transform">
                  Find Routes →
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Safest',   score: Math.min(100, safetyScore + 10), color: '#10B981', time: '18 min', dist: '5.1 km' },
                  { label: 'Balanced', score: safetyScore,                     color: '#004ac6', time: '14 min', dist: '4.2 km' },
                  { label: 'Fastest',  score: Math.max(40, safetyScore - 12),  color: '#F59E0B', time: '10 min', dist: '3.8 km' },
                ].map(r => (
                  <div key={r.label} className="rounded-xl p-2.5 text-center border border-[#f0f0f0]" style={{ background: r.color + '08' }}>
                    <p className="text-[9px] font-black text-[#737686] uppercase tracking-wider">{r.label}</p>
                    <p className="text-2xl font-black" style={{ color: r.color }}>{r.score}</p>
                    <p className="text-[10px] font-bold text-[#191c1e]">{r.time}</p>
                    <p className="text-[9px] text-[#737686]">{r.dist}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Area Alerts */}
            {(() => {
              const alerts = []
              if (weather?.temperature > 38)
                alerts.push({ icon: '🔆', text: 'Extreme Heat Alert — Stay hydrated', color: '#EF4444' })
              if (weather?.humidity > 85)
                alerts.push({ icon: '🌊', text: 'High Humidity — Waterlogging risk', color: '#3B82F6' })
              if (weather?.description?.toLowerCase().includes('rain'))
                alerts.push({ icon: '🌧️', text: 'Heavy Rain — Check for waterlogging', color: '#6366F1' })
              if (weather?.description?.toLowerCase().includes('storm') || weather?.description?.toLowerCase().includes('thunder'))
                alerts.push({ icon: '⛈️', text: 'Storm Warning — Avoid travel', color: '#F59E0B' })
              return (
                <div className="bg-white rounded-2xl p-3.5 mb-3 shadow-sm border border-[#eceef0]">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="material-symbols-outlined text-[#F59E0B] icon-filled text-[18px]">crisis_alert</span>
                    <span className="font-black text-sm text-[#191c1e]">Area Alerts</span>
                    <span className="ml-auto text-[9px] font-bold text-[#737686] uppercase tracking-wider">Live</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    {alerts.length === 0 ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-shrink-0" style={{ background: '#10B98110' }}>
                        <span>✅</span>
                        <span className="text-[10px] font-bold" style={{ color: '#10B981' }}>No active alerts in your area</span>
                      </div>
                    ) : alerts.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl flex-shrink-0" style={{ background: a.color + '10', border: `1px solid ${a.color}30` }}>
                        <span>{a.icon}</span>
                        <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: a.color }}>{a.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* People Near Me — show count when live tracking is active */}
            {liveUsers.length > 0 && (
              <div className="bg-white rounded-2xl p-3.5 mb-3 shadow-sm border border-[#8B5CF6]/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined icon-filled text-[18px]" style={{ color: '#8B5CF6' }}>group</span>
                  <span className="font-black text-sm text-[#191c1e]">People Near Me</span>
                  <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#8B5CF620', color: '#8B5CF6' }}>
                    {liveUsers.length} online
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {liveUsers.map(u => (
                    <div key={u.id} className="flex-shrink-0 flex flex-col items-center gap-1">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-white text-sm"
                        style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}>
                        {(u.name || '?')[0].toUpperCase()}
                      </div>
                      <span className="text-[9px] font-bold text-[#434655] truncate max-w-[48px]">{u.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Nearby Safe Places */}
            <div className="bg-white rounded-2xl p-3.5 mb-3 shadow-sm border border-[#eceef0]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#10B981] icon-filled text-[18px]">local_hospital</span>
                  <span className="font-black text-sm text-[#191c1e]">Nearby Safe Places</span>
                </div>
                {loadingPlaces && <span className="material-symbols-outlined text-[#737686] text-[16px] animate-spin">refresh</span>}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                {nearbyPlaces.length === 0 ? (
                  <p className="text-xs text-[#737686] py-2">Loading nearby places…</p>
                ) : nearbyPlaces.slice(0, 6).map(p => {
                  const cfg = AMENITY_CFG[p.amenity] || { color: '#737686', icon: 'place' }
                  return (
                    <div key={p.id} className="flex-shrink-0 bg-[#f7f9fb] rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 min-w-[72px] border border-[#eceef0]">
                      <span className="material-symbols-outlined icon-filled text-[20px]" style={{ color: cfg.color }}>{cfg.icon}</span>
                      <span className="text-[9px] font-black text-[#191c1e] text-center leading-tight max-w-[64px] truncate">{p.name}</span>
                      <span className="text-[9px] font-bold text-[#737686]">{formatNearbyDistance(p.distance)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Navigate', icon: 'navigation', action: () => navigate('/search'), color: '#004ac6' },
                { label: 'Safety',   icon: 'shield',     action: () => navigate('/safety'), color: '#10B981' },
                { label: 'Report',   icon: 'flag',       action: () => navigate('/reports'), color: '#F59E0B' },
                { label: 'Profile',  icon: 'person',     action: () => navigate('/profile'), color: '#737686' },
              ].map(a => (
                <button key={a.label} onClick={a.action}
                  className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 border border-[#eceef0] active:scale-90 transition-transform shadow-sm">
                  <span className="material-symbols-outlined icon-filled text-[22px]" style={{ color: a.color }}>{a.icon}</span>
                  <span className="text-[9px] font-black text-[#737686] uppercase tracking-wider">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
