import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../../context/store'

// Smart auto-replies keyed by topic
const R = {
  greeting:   "Hello! I'm your Safety Guardian assistant, always here to help.\n\nYou can ask me about:\n- Emergency contacts and numbers\n- Route safety scores\n- Flood or storm advice\n- How to report hazards\n- SOS activation\n\nWhat can I help you with?",
  howAreYou:  "I'm always alert and ready to keep you safe!\n\nIs there anything safety-related I can help you with today?",
  help:       "Here's what I can help with:\n\n**Flood advice** - what to do during floods\n**Emergency numbers** - police, ambulance, fire\n**Hazard reporting** - how to submit a community report\n**Route safety** - how scores are calculated\n**SOS** - how to trigger emergency help\n**Emergency contacts** - how to add them\n\nJust ask anything!",
  earthquake: "During an earthquake: DROP, COVER, HOLD ON.\n\n1. Drop to your hands and knees\n2. Take cover under a sturdy table or desk\n3. Hold on until shaking stops\n4. Check for injuries before moving\n\nCall **1078** (NDMA) if you need rescue assistance.",
  hazard:     "To **report a hazard**:\n\n1. Tap the Report tab in the bottom navigation\n2. Pick your location on the map\n3. Select the hazard type (flood, fire, road damage, etc.)\n4. Add description and submit\n\nYour report helps the whole community stay safe!",
  emergency:  "Emergency numbers in West Bengal:\n\nPolice: **100**\nAmbulance: **108**\nFire Brigade: **101**\nWomen Helpline: **1091**\nNDMA Helpline: **1078**\n\nSave these now - they could save your life!",
  flood:      "If flooding is reported near you:\n\n- Move to higher ground immediately\n- Never walk or drive through floodwater\n- Disconnect all electrical appliances\n- Call **1078** (NDMA) if you need rescue\n\nWater levels can rise very quickly - stay safe!",
  storm:      "During a storm or cyclone:\n\n- Stay indoors away from windows and doors\n- Avoid trees, poles, and metal structures\n- Keep your phone charged\n- Do not drive during heavy storms\n\nIf stranded, trigger SOS to alert your emergency contacts.",
  sos:        "To trigger emergency SOS:\n\n- **Press and hold** the red SOS button for 1.5 seconds\n- **Double-tap** it quickly\n- **Shake your phone** firmly\n\nOnce triggered your emergency contacts are notified instantly with your live GPS location.",
  contact:    "To add emergency contacts:\n\n1. Go to the Profile tab\n2. Scroll to Emergency Contacts\n3. Tap ADD and enter name and phone\n4. Optionally import from phone contacts\n\nThey receive your live GPS location when you trigger SOS.",
  route:      "Route safety scores are calculated from:\n\n- Community hazard reports on the route\n- Proximity to hospitals and police stations\n- Flood zone risk data\n- Historical crime hotspots\n- Real-time traffic conditions\n\nA score above **80** is generally safe. Tap any route card to see the full breakdown.",
  navigation: "To start navigation:\n\n1. Tap the Journey tab or search bar on Home\n2. Type or speak your destination\n3. Choose from Safest, Balanced, or Fastest routes\n4. Tap Start Journey\n\nYou will get turn-by-turn instructions with hazard warnings along the route.",
  weather:    "Current weather is shown on the Home screen - look for the weather card at the top right of the map.\n\nWeather affects route safety:\n- Heavy rain means waterlogging risk\n- Storms mean avoid travel if possible\n- Extreme heat means stay hydrated\n\nThese alerts also appear in the Area Alerts section on Home.",
  hospital:   "To find the nearest hospital:\n\n- Look for red markers on the Home map\n- Check Nearby Safe Places in the bottom sheet\n- In an emergency tap SOS - nearest hospital is shown on the screen\n\nFor immediate medical help call **108** (ambulance).",
  police:     "To find the nearest police station:\n\n- Look for blue markers on the Home map\n- Check Nearby Safe Places in the bottom sheet\n- Emergency police number: **100**\n\nYou can also report unsafe situations using the Report tab.",
  crime:      "To report criminal activity or unsafe areas:\n\n1. Go to the Report tab\n2. Select hazard type - Criminal Threat or Unsafe Area\n3. Pin the exact location on the map\n4. Add a description and submit\n\nFor immediate danger: call **100** (police) or trigger SOS.",
  safe:       "Safety score ranges:\n\nGreen 80 to 100 = Safe Zone - low risk, proceed normally\nYellow 60 to 79 = Moderate - drive carefully, stay alert\nRed below 60 = High Risk - consider an alternative route\n\nScores update in real-time as community reports come in.",
  default:    "I didn't quite catch that, but I'm here to help!\n\nTry asking me:\n- Hello or Hi to get started\n- Emergency numbers\n- Flood advice\n- Route safety scores\n- How to trigger SOS\n- Finding hospitals or police nearby",
}

function getBotReply(text) {
  const t = text.toLowerCase().trim()

  // Greetings
  if (/^(hi|hello|hey|howdy|good morning|good afternoon|good evening|namaste)\b/.test(t)) return R.greeting
  if (t.includes('how are you') || t.includes('how r u') || t.includes("what's up") || t.includes('whats up')) return R.howAreYou
  if (/^(help|assist|what can you do|what do you do)\b/.test(t)) return R.help

  // Specific safety topics
  if (t.includes('earthquake') || t.includes('quake'))               return R.earthquake
  if (t.includes('storm') || t.includes('cyclone') || t.includes('thunder')) return R.storm
  if (t.includes('flood') || t.includes('waterlog'))                 return R.flood
  if (t.includes('weather') || (t.includes('rain') && !t.includes('drain')) || t.includes('heat')) return R.weather
  if (t.includes('hospital') || t.includes('ambulance') || t.includes('medical')) return R.hospital
  if (t.includes('police') || t.includes('cop') || t.includes('station')) return R.police
  if (t.includes('crime') || t.includes('theft') || t.includes('robbery') || t.includes('unsafe')) return R.crime
  if (t.includes('navigate') || t.includes('navigation') || t.includes('direction')) return R.navigation
  if (t.includes('route') || t.includes('safest route'))             return R.route
  if (t.includes('score') || t.includes('safe'))                     return R.safe
  if (t.includes('sos') || t.includes('shake') || t.includes('trigger') || t.includes('emergency alert')) return R.sos
  if (t.includes('contact') || t.includes('family') || t.includes('emergency contact')) return R.contact
  if (t.includes('report') || t.includes('hazard') || t.includes('submit')) return R.hazard
  if (t.includes('emergency') || t.includes('helpline') || t.includes('number') || t.includes('call')) return R.emergency

  return R.default
}

const QUICK_CHIPS = [
  { label: 'Flood advice',      text: 'What should I do during a flood?' },
  { label: 'Emergency numbers', text: 'What are the emergency numbers?' },
  { label: 'Report hazard',     text: 'How to report a hazard?' },
  { label: 'Route safety',      text: 'How is route safety score calculated?' },
  { label: 'SOS help',          text: 'How do I trigger an SOS?' },
  { label: 'Add contacts',      text: 'How do I add emergency contacts?' },
]

// Render **bold** and newlines
function renderText(text) {
  return text.split('\n').map((line, i) => (
    <p key={i} className={i > 0 ? 'mt-1' : ''}>
      {line.split('**').map((chunk, j) =>
        j % 2 === 1 ? <strong key={j}>{chunk}</strong> : chunk
      )}
    </p>
  ))
}

export default function ChatPage() {
  const navigate = useNavigate()
  const { setSosActive } = useAppStore()
  const messagesEndRef = useRef(null)
  const recognitionRef = useRef(null)
  const textareaRef = useRef(null)

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: "Hello! I'm your Safety Guardian assistant.\n\nI can help you with:\n- Emergency procedures\n- Route safety information\n- Hazard reporting\n- SOS activation\n\nHow can I help you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [speechError, setSpeechError] = useState('')

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Web Speech API init
  useEffect(() => {
    if (typeof window === 'undefined') return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-IN'

    recognition.onstart = () => { setIsListening(true); setSpeechError('') }
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join('')
      setInput(transcript)
    }
    recognition.onerror = (event) => {
      setSpeechError(event.error === 'not-allowed'
        ? 'Microphone permission denied.'
        : 'Could not hear you. Try again.')
      setIsListening(false)
    }
    recognition.onend = () => setIsListening(false)

    recognitionRef.current = recognition
    return () => { try { recognition.abort() } catch (_) {} }
  }, [])

  const toggleVoice = () => {
    if (!recognitionRef.current) { setSpeechError('Voice input not supported in this browser.'); return }
    if (isListening) { recognitionRef.current.stop() }
    else { setSpeechError(''); try { recognitionRef.current.start() } catch (_) {} }
  }

  const sendMessage = (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    
    // Auto-SOS trigger for exact "help me" matches
    if (trimmed.toLowerCase() === 'help me') {
      setInput('')
      setSosActive(true)
      navigate('/emergency')
      return
    }
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setMessages(prev => [...prev, { id: Date.now(), sender: 'user', text: trimmed, timestamp: ts }])
    setInput('')
    setIsTyping(true)
    setTimeout(() => {
      setIsTyping(false)
      setMessages(prev => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: getBotReply(trimmed),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ])
    }, 900 + Math.random() * 600)
  }

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden" style={{ background: '#f0f4ff' }}>

      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 pt-11 pb-4 flex-shrink-0"
        style={{
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(0,74,198,0.08)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
          style={{ background: '#eceef0' }}
        >
          <span className="material-symbols-outlined text-[#434655]">arrow_back</span>
        </button>

        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #0062f5, #004ac6)', boxShadow: '0 4px 12px rgba(0,74,198,0.3)' }}
        >
          <span className="material-symbols-outlined text-white icon-filled text-[20px]">smart_toy</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-[#191c1e] leading-tight">Safety Assistant</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
            <p className="text-[10px] text-[#10B981] font-bold">Online</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ overscrollBehavior: 'contain' }}>
        {messages.map(msg => {
          const isUser = msg.sender === 'user'
          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
                style={
                  isUser
                    ? { background: 'linear-gradient(135deg, #0062f5, #004ac6)', color: 'white', boxShadow: '0 4px 12px rgba(0,74,198,0.25)' }
                    : { background: 'white', color: '#191c1e', border: '1px solid rgba(0,74,198,0.08)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }
                }
              >
                <div className="text-sm leading-relaxed">{renderText(msg.text)}</div>
              </div>
              <p className="text-[9px] text-[#737686] mt-1 mx-1 font-semibold">{msg.timestamp}</p>
            </div>
          )
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex items-start">
            <div className="rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center"
              style={{ background: 'white', border: '1px solid rgba(0,74,198,0.08)' }}>
              {[0, 150, 300].map(delay => (
                <div key={delay} className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: '#004ac6', opacity: 0.4, animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area — padded so Send button clears the bottom nav bar */}
      <div
        className="flex-shrink-0 px-4 pt-3 pb-5"
        style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(0,74,198,0.08)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.03)',
        }}
      >
        {/* Quick chips */}
        <div className="flex gap-2 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
          {QUICK_CHIPS.map((chip, i) => (
            <button
              key={i}
              onClick={() => sendMessage(chip.text)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95"
              style={{
                background: 'rgba(0,74,198,0.06)',
                color: '#004ac6',
                border: '1px solid rgba(0,74,198,0.18)',
                whiteSpace: 'nowrap',
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Speech error */}
        {speechError && <p className="text-xs text-[#EF4444] mb-2 ml-1">{speechError}</p>}

        {/* Listening banner */}
        {isListening && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="flex gap-0.5">
              {[0, 100, 200].map(d => (
                <div key={d} className="w-1 rounded-full animate-bounce"
                  style={{ height: 12 + (d / 100) * 4, background: '#EF4444', animationDelay: `${d}ms` }} />
              ))}
            </div>
            <p className="text-xs font-bold text-[#EF4444]">Listening... speak now</p>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          {/* Mic button */}
          <button
            onClick={toggleVoice}
            title={isListening ? 'Stop listening' : 'Speak your message'}
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
            style={{
              background: isListening ? 'rgba(239,68,68,0.1)' : 'rgba(0,74,198,0.06)',
              border: isListening ? '1.5px solid rgba(239,68,68,0.3)' : '1.5px solid rgba(0,74,198,0.15)',
            }}
          >
            <span
              className={`material-symbols-outlined text-[20px] ${isListening ? 'icon-filled animate-pulse' : ''}`}
              style={{ color: isListening ? '#EF4444' : '#004ac6' }}
            >
              {isListening ? 'mic' : 'mic_none'}
            </span>
          </button>

          {/* Text area */}
          <div
            className="flex-1 rounded-2xl px-4 py-3 flex items-center transition-all"
            style={{
              background: '#f0f4ff',
              border: `1.5px solid ${isListening ? 'rgba(239,68,68,0.3)' : 'rgba(0,74,198,0.15)'}`,
              minHeight: 48,
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
              }}
              placeholder={isListening ? 'Listening...' : 'Ask me anything about safety...'}
              className="w-full bg-transparent outline-none text-sm text-[#191c1e] resize-none leading-relaxed placeholder:text-[#737686]"
              style={{ maxHeight: 96 }}
              rows={1}
            />
          </div>

          {/* Send button */}
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
            style={{
              background: input.trim() ? 'linear-gradient(135deg, #0062f5, #004ac6)' : '#eceef0',
              color: input.trim() ? 'white' : '#c3c6d7',
              boxShadow: input.trim() ? '0 4px 12px rgba(0,74,198,0.35)' : 'none',
            }}
          >
            <span className="material-symbols-outlined icon-filled text-[20px]">send</span>
          </button>
        </div>
      </div>
    </div>
  )
}
