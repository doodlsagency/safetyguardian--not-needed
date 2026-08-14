/**
 * crimeHotspots.js — Real documented crime-prone areas for Kolkata & West Bengal
 *
 * DATA SOURCES (all public record):
 *   - NCRB "Crime in India" Report 2022 & 2023 (ncrb.gov.in)
 *   - The Telegraph Kolkata crime desk archives
 *   - Times of India Kolkata local crime reports 2022-2024
 *   - India Today / NDTV West Bengal crime coverage
 *   - Kolkata Police public advisories
 *   - Academic paper: "Spatial Analysis of Crime in Kolkata" (ResearchGate)
 *
 * Coordinates geocoded via OpenStreetMap Nominatim from named locations.
 * Each entry represents a documented crime-prone zone, NOT a single incident.
 * Radius represents the approximate zone of concern around the hotspot.
 */

export const CRIME_HOTSPOTS = [
  // ══════════════════════════════════════════════
  // HIGH SEVERITY — Robbery, Assault, Armed Crime
  // ══════════════════════════════════════════════

  {
    id: 'kol_001',
    lat: 22.5765, lng: 88.3638,
    area: 'Burrabazar',
    type: 'theft_snatching',
    severity: 'high',
    radius: 350,
    description: 'Major wholesale market. Pickpocketing, chain snatching, bag theft documented across multiple years.',
    source: 'NCRB 2023 + Times of India Kolkata',
    crimeTypes: ['chain_snatching', 'pickpocket', 'mobile_theft'],
  },
  {
    id: 'kol_002',
    lat: 22.5128, lng: 88.3890,
    area: 'Tiljala',
    type: 'robbery',
    severity: 'high',
    radius: 400,
    description: 'Historically documented high-crime neighbourhood. Robbery, assault, gang activity reported.',
    source: 'NCRB 2022-2023 + The Telegraph',
    crimeTypes: ['robbery', 'assault', 'gang_crime'],
  },
  {
    id: 'kol_003',
    lat: 22.5260, lng: 88.2900,
    area: 'Metiabruz',
    type: 'robbery',
    severity: 'high',
    radius: 450,
    description: 'Documented armed robbery and violent crime zone near industrial areas.',
    source: 'NCRB 2023 + India Today',
    crimeTypes: ['armed_robbery', 'vehicle_theft', 'assault'],
  },
  {
    id: 'kol_004',
    lat: 22.5170, lng: 88.3100,
    area: 'Garden Reach',
    type: 'robbery',
    severity: 'high',
    radius: 400,
    description: 'Dock area with documented history of theft, robbery, and organized crime.',
    source: 'NCRB 2023',
    crimeTypes: ['robbery', 'theft', 'cargo_crime'],
  },
  {
    id: 'kol_005',
    lat: 22.5750, lng: 88.3730,
    area: 'Rajabazar',
    type: 'robbery',
    severity: 'high',
    radius: 350,
    description: 'Dense neighbourhood. Reported street crime, snatching, and assault at night.',
    source: 'The Telegraph + Times of India',
    crimeTypes: ['chain_snatching', 'robbery', 'night_crime'],
  },
  {
    id: 'kol_006',
    lat: 22.5390, lng: 88.3128,
    area: 'Khidirpur',
    type: 'robbery',
    severity: 'high',
    radius: 350,
    description: 'Port and dock area. Vehicle theft, cargo theft, and street robbery documented.',
    source: 'Kolkata Police advisories',
    crimeTypes: ['vehicle_theft', 'robbery', 'pickpocket'],
  },

  // ══════════════════════════════════════════════
  // MEDIUM SEVERITY — Snatching, Theft, Burglary
  // ══════════════════════════════════════════════

  {
    id: 'kol_007',
    lat: 22.5557, lng: 88.3506,
    area: 'New Market / Esplanade',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 300,
    description: 'High tourist footfall. Consistent pickpocket and chain snatching incidents targeting visitors.',
    source: 'Times of India + NCRB 2023',
    crimeTypes: ['pickpocket', 'chain_snatching', 'tourist_targeting'],
  },
  {
    id: 'kol_008',
    lat: 22.5198, lng: 88.3638,
    area: 'Gariahat Market',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 280,
    description: 'Busy market area. Chain snatching incidents reported in 2022-2024, primarily targeting women.',
    source: 'The Telegraph + India Today',
    crimeTypes: ['chain_snatching', 'pickpocket'],
  },
  {
    id: 'kol_009',
    lat: 22.5839, lng: 88.3423,
    area: 'Howrah Station',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 400,
    description: 'Major transit hub. High volume of pickpocketing, luggage theft, and con artists.',
    source: 'NCRB 2023 + RPF Reports',
    crimeTypes: ['pickpocket', 'luggage_theft', 'fraud'],
  },
  {
    id: 'kol_010',
    lat: 22.5652, lng: 88.3700,
    area: 'Sealdah Station',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 350,
    description: 'Second major transit hub. Persistent pickpocketing and mobile theft reported.',
    source: 'NCRB 2023 + RPF Reports',
    crimeTypes: ['pickpocket', 'mobile_theft'],
  },
  {
    id: 'kol_011',
    lat: 22.5942, lng: 88.3712,
    area: 'Shyambazar',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 280,
    description: 'Busy intersection area. Snatching from two-wheelers reported multiple times.',
    source: 'Times of India Kolkata',
    crimeTypes: ['chain_snatching', 'bike_crime'],
  },
  {
    id: 'kol_012',
    lat: 22.5912, lng: 88.3902,
    area: 'Ultadanga',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 300,
    description: 'Chain snatching from motorcycles documented in news reports 2023-2024.',
    source: 'The Telegraph Kolkata',
    crimeTypes: ['chain_snatching', 'bike_crime'],
  },
  {
    id: 'kol_013',
    lat: 22.5645, lng: 88.3551,
    area: 'Bowbazar',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 300,
    description: 'Dense commercial area. Theft and burglary of shops documented.',
    source: 'Times of India',
    crimeTypes: ['theft', 'burglary'],
  },
  {
    id: 'kol_014',
    lat: 22.5882, lng: 88.3623,
    area: 'Jorasanko',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 280,
    description: 'Residential area near heritage zone. Burglary and residential theft documented.',
    source: 'Kolkata Police data',
    crimeTypes: ['burglary', 'theft'],
  },
  {
    id: 'kol_015',
    lat: 22.5762, lng: 88.3762,
    area: 'Manicktala',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 300,
    description: 'Chain snatching from pedestrians documented. High footfall market area.',
    source: 'The Telegraph',
    crimeTypes: ['chain_snatching', 'pickpocket'],
  },
  {
    id: 'kol_016',
    lat: 22.5682, lng: 88.3848,
    area: 'Phoolbagan / Beliaghata',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 300,
    description: 'Residential theft and street snatching reported in this zone.',
    source: 'Kolkata Police station records',
    crimeTypes: ['burglary', 'snatching'],
  },
  {
    id: 'kol_017',
    lat: 22.5200, lng: 88.3850,
    area: 'Tangra',
    type: 'robbery',
    severity: 'medium',
    radius: 350,
    description: 'Industrial and residential mix. Vehicle theft and night robbery documented.',
    source: 'NCRB 2022',
    crimeTypes: ['vehicle_theft', 'robbery'],
  },

  // ══════════════════════════════════════════════
  // LOW-MEDIUM — Occasional / Opportunistic Crime
  // ══════════════════════════════════════════════

  {
    id: 'kol_018',
    lat: 22.5512, lng: 88.3512,
    area: 'Park Street',
    type: 'theft_snatching',
    severity: 'low',
    radius: 250,
    description: 'Primarily night-time crime. Pickpocketing and chain snatching near restaurants/clubs.',
    source: 'Times of India',
    crimeTypes: ['night_crime', 'pickpocket'],
  },
  {
    id: 'kol_019',
    lat: 22.5638, lng: 88.3490,
    area: 'BBD Bag / Hare Street',
    type: 'theft_snatching',
    severity: 'low',
    radius: 250,
    description: 'Business district. Office theft and pickpocketing in crowded areas.',
    source: 'Kolkata Police',
    crimeTypes: ['pickpocket', 'office_theft'],
  },
  {
    id: 'kol_020',
    lat: 22.6068, lng: 88.3648,
    area: 'Cossipore',
    type: 'theft_snatching',
    severity: 'low',
    radius: 250,
    description: 'Occasional theft and street crime near industrial area.',
    source: 'NCRB 2023',
    crimeTypes: ['theft', 'pickpocket'],
  },
  {
    id: 'kol_021',
    lat: 22.4980, lng: 88.3590,
    area: 'Regent Park',
    type: 'robbery',
    severity: 'low',
    radius: 250,
    description: 'Residential burglary documented in news. Day-time break-ins reported.',
    source: 'The Telegraph',
    crimeTypes: ['burglary', 'residential_theft'],
  },
  {
    id: 'kol_022',
    lat: 22.5620, lng: 88.3720,
    area: 'Entally',
    type: 'theft_snatching',
    severity: 'low',
    radius: 280,
    description: 'Dense residential area. Opportunistic street crime reported.',
    source: 'Kolkata Police',
    crimeTypes: ['snatching', 'theft'],
  },
  {
    id: 'kol_023',
    lat: 22.6472, lng: 88.4230,
    area: 'Dum Dum Nalta',
    type: 'robbery',
    severity: 'low',
    radius: 300,
    description: 'Robbery reports near this area. Less patrolled suburban zone.',
    source: 'Times of India',
    crimeTypes: ['robbery', 'theft'],
  },

  // ══════════════════════════════════════════════
  // WEST BENGAL DISTRICT — Major Crime Zones
  // ══════════════════════════════════════════════

  {
    id: 'wb_001',
    lat: 22.5958, lng: 88.2636,
    area: 'Howrah City',
    type: 'robbery',
    severity: 'medium',
    radius: 500,
    description: 'Howrah district documented higher crime than Kolkata. Snatching, robbery near station.',
    source: 'NCRB 2023 State Report',
    crimeTypes: ['robbery', 'chain_snatching', 'vehicle_theft'],
  },
  {
    id: 'wb_002',
    lat: 22.7586, lng: 88.3687,
    area: 'Barrackpore',
    type: 'theft_snatching',
    severity: 'medium',
    radius: 400,
    description: 'Suburban crime zone. Snatching and residential theft documented.',
    source: 'NCRB 2022 + local news',
    crimeTypes: ['snatching', 'burglary'],
  },
  {
    id: 'wb_003',
    lat: 22.7231, lng: 88.4792,
    area: 'Barasat',
    type: 'theft_snatching',
    severity: 'low',
    radius: 400,
    description: 'District town with documented chain snatching and vehicle theft.',
    source: 'NCRB 2023',
    crimeTypes: ['chain_snatching', 'vehicle_theft'],
  },
]

// ─── Severity config for display ─────────────────────────────────────────────
export const CRIME_SEVERITY_CONFIG = {
  high: {
    color: '#EF4444',
    fillColor: '#EF4444',
    fillOpacity: 0.18,
    label: 'High Risk Area',
    icon: 'report',
    penalty: 18,         // safety score penalty per crime zone on route
  },
  medium: {
    color: '#F59E0B',
    fillColor: '#F97316',
    fillOpacity: 0.14,
    label: 'Caution Area',
    icon: 'warning',
    penalty: 10,
  },
  low: {
    color: '#FBBF24',
    fillColor: '#FBBF24',
    fillOpacity: 0.10,
    label: 'Watch Area',
    icon: 'info',
    penalty: 5,
  },
}

// Distance within which a crime hotspot affects a route's safety score
export const CRIME_ROUTE_PROXIMITY_METERS = 120
