import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import introUrl from './assets/intro.mp3'
import clickUrl from './assets/click.mp3'
import ContinueStars from './components/ContinueStars'
import OptionsDialog from './components/OptionsDialog'
import { loadSettings, saveSettings, channelVolume } from './settings'
import { loadAll, standing, addScore, qualifies, lastName, calcScore, formatTime, NAME_MAX, MAX_SCORES } from './hiscores'
import { trackPlay } from './analytics'
import './App.css'

// UI click sound — cloned per press so rapid clicks overlap
const clickAudio = new Audio(clickUrl)
const playClick = () => { const a = clickAudio.cloneNode(); a.volume = 0.55 * channelVolume(loadSettings(), 'effects'); a.play().catch(() => {}) }

// three.js (~700 kB) only loads when a battle starts
const Game = lazy(() => import('./Game'))

function MenuArt() {
  // war-torn cityscape + two facing tanks, blue-vs-fire sky — key-art style
  return (
    <svg className="menu-art" viewBox="0 0 1440 810" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#12293e" />
          <stop offset="0.42" stopColor="#2e4658" />
          <stop offset="0.58" stopColor="#5a4a35" />
          <stop offset="1" stopColor="#7a2f08" />
        </linearGradient>
        <radialGradient id="sunG" cx="0.5" cy="0.4" r="0.35">
          <stop offset="0" stopColor="#ffdf9a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffdf9a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fireG" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb340" />
          <stop offset="0.6" stopColor="#e05e12" stopOpacity="0.8" />
          <stop offset="1" stopColor="#e05e12" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="groundG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2013" /><stop offset="1" stopColor="#050604" />
        </linearGradient>
      </defs>

      <rect width="1440" height="810" fill="url(#sky)" />
      <rect width="1440" height="810" fill="url(#sunG)" />
      {/* smoke clouds */}
      <ellipse cx="250" cy="140" rx="300" ry="80" fill="#0e1c2c" opacity="0.55" />
      <ellipse cx="1150" cy="120" rx="340" ry="90" fill="#3a1503" opacity="0.6" />
      <ellipse cx="980" cy="220" rx="260" ry="70" fill="#57200a" opacity="0.5" />

      {/* planes */}
      {[[220, 120, 1], [330, 170, 0.7], [1140, 90, -1], [1250, 150, -0.8], [980, 130, -0.6]].map(([px, py, ps], i) => (
        <path key={i} d="M0 0 L26 -6 L44 0 L26 2 L30 8 L14 4 Z" fill="#0a0d12"
          transform={`translate(${px},${py}) scale(${ps},${Math.abs(ps)})`} opacity="0.85" />
      ))}
      {/* tracer streaks */}
      <line x1="860" y1="160" x2="960" y2="120" stroke="#ffb340" strokeWidth="2" opacity="0.7" />
      <line x1="480" y1="190" x2="560" y2="160" stroke="#9ecfff" strokeWidth="2" opacity="0.5" />

      {/* ruined skyline left (blue side) */}
      <g fill="#0d1520">
        <rect x="0" y="330" width="70" height="200" />
        <path d="M70 340 L140 340 L140 530 L70 530 Z M80 360 h14 v18 h-14 Z M106 360 h14 v18 h-14 Z" fillRule="evenodd" />
        <path d="M140 300 L210 320 L200 530 L140 530 Z" />
        <rect x="210" y="380" width="60" height="150" />
        <path d="M270 350 L330 330 L340 530 L270 530 Z" />
      </g>
      <g fill="#152434" opacity="0.7">
        <rect x="60" y="420" width="100" height="110" />
        <rect x="230" y="440" width="90" height="90" />
      </g>

      {/* ruined skyline right (fire side) */}
      <g fill="#1c0e05">
        <path d="M1130 340 L1210 320 L1220 530 L1130 530 Z" />
        <rect x="1220" y="300" width="80" height="230" />
        <path d="M1300 360 L1380 340 L1390 530 L1300 530 Z" />
        <rect x="1390" y="380" width="50" height="150" />
      </g>
      <g fill="#2e1407" opacity="0.75">
        <rect x="1150" y="430" width="110" height="100" />
        <rect x="1290" y="450" width="90" height="80" />
      </g>
      {/* explosion glow right */}
      <circle cx="1200" cy="380" r="220" fill="url(#fireG)" opacity="0.85" />
      <circle cx="1260" cy="430" r="90" fill="#ffcf70" opacity="0.5" />
      {/* searchlight beams */}
      <path d="M180 530 L120 180 L160 180 Z" fill="#9ecfff" opacity="0.12" />
      <path d="M1320 530 L1380 200 L1340 200 Z" fill="#ffb340" opacity="0.12" />

      {/* mid-ground rubble */}
      <path d="M0 530 Q200 500 420 528 Q700 555 900 525 Q1200 495 1440 530 L1440 610 L0 610 Z" fill="#101408" />
      {/* ground */}
      <rect y="560" width="1440" height="250" fill="url(#groundG)" />
      {/* cracked road center */}
      <path d="M660 560 L780 560 L900 810 L520 810 Z" fill="#15181c" />
      <line x1="718" y1="580" x2="700" y2="700" stroke="#2c3440" strokeWidth="3" />
      <line x1="740" y1="620" x2="780" y2="760" stroke="#2c3440" strokeWidth="2" />
      {/* debris */}
      <g fill="#0a0c07">
        <rect x="420" y="690" width="60" height="18" transform="rotate(8 450 700)" />
        <rect x="950" y="700" width="70" height="16" transform="rotate(-6 980 700)" />
        <circle cx="560" cy="740" r="12" />
        <circle cx="880" cy="730" r="10" />
      </g>
      {/* telephone poles */}
      <g stroke="#0a0c07" strokeWidth="7">
        <line x1="470" y1="360" x2="470" y2="560" />
        <line x1="445" y1="380" x2="495" y2="380" />
        <line x1="1030" y1="350" x2="1030" y2="555" />
        <line x1="1005" y1="370" x2="1055" y2="370" />
      </g>

      {/* tanks come from the in-game GLB models (rendered imgs overlaid in DOM) */}

      {/* vignette */}
      <rect width="1440" height="810" fill="url(#fireG)" opacity="0.06" />
      <rect width="1440" height="810" fill="#000" opacity="0.12" />
    </svg>
  )
}

// rising ember sparks along the bottom edge (looping particle canvas)
function EmberFX() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    let W, H, raf
    const resize = () => { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight }
    resize()
    window.addEventListener('resize', resize)
    const P = []
    const spawn = () => ({
      x: Math.random() * W, y: H + 10,
      vx: (Math.random() - 0.5) * 0.35, vy: -(0.25 + Math.random() * 0.85),
      len: 3 + Math.random() * 8, life: 0, max: 320 + Math.random() * 320,
      w: 0.7 + Math.random() * 1.4, flick: Math.random() * 6.28,
    })
    const tick = () => {
      ctx.clearRect(0, 0, W, H)
      if (P.length < 260 && Math.random() < 0.95) P.push(spawn())
      ctx.globalCompositeOperation = 'lighter'
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]
        p.life++
        p.x += p.vx + Math.sin((p.life + p.flick * 60) * 0.04) * 0.6
        p.y += p.vy
        p.vy *= 0.999
        const a = Math.max(0, 1 - p.life / p.max) * (0.55 + 0.45 * Math.sin(p.life * 0.25 + p.flick))
        if (a <= 0 || p.y < -20) { P.splice(i, 1); continue }
        // streak drawn along velocity
        const tl = Math.hypot(p.vx, p.vy) || 1
        const dx = (p.vx / tl) * p.len, dy = (p.vy / tl) * p.len
        const g = ctx.createLinearGradient(p.x, p.y, p.x + dx, p.y + dy)
        g.addColorStop(0, `rgba(255,120,20,0)`)
        g.addColorStop(0.5, `rgba(255,150,40,${a})`)
        g.addColorStop(1, `rgba(255,220,120,${a})`)
        ctx.strokeStyle = g
        ctx.lineWidth = p.w
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + dx, p.y + dy)
        ctx.stroke()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} className="ember-fx" />
}

function MapSelect({ onPick, onBack }) {
  const tex = (f) => `${import.meta.env.BASE_URL}assets/textures/${f}`
  const maps = [
    { id: 'forest', name: 'FOREST', desc: 'Dense oak woodland — water & hills', level: 'easy', img: tex('ground-color.jpg'), tint: 'rgba(16,34,14,.38)' },
    { id: 'city', name: 'CITY', desc: 'Ruined blocks, streets & burning wrecks', level: 'medium', img: tex('rock-color.jpg'), tint: 'rgba(14,16,20,.42)' },
    { id: 'snow', name: 'SNOW', desc: 'Frozen field — pines, snowfall & ice', level: 'hard', img: tex('ground-color.jpg'), tint: 'rgba(190,212,236,.6)' },
  ]
  return (
    <div className="map-select">
      <h1 className="map-title">SELECT MAP</h1>
      <div className="map-cards">
        {maps.map((m) => (
          <button key={m.id} className="map-card" onClick={() => { playClick(); onPick(m.id) }}
            style={m.img ? { backgroundImage: `linear-gradient(${m.tint}, rgba(8,10,14,.85)), url('${m.img}')`, backgroundSize: 'cover' } : undefined}>
            <span className="map-card-name">{m.name}</span>
            <span className={`map-card-level ${m.level}`}>{m.level.toUpperCase()} AI</span>
            <span className="map-card-desc">{m.desc}</span>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={() => { playClick(); onBack() }}>BACK</button>
      <EmberFX />
    </div>
  )
}

function StartScreen({ onStart, onHiScores, settings, onSettings }) {
  const [options, setOptions] = useState(false)
  const optionsButtonRef = useRef(null)
  return (
    <div className="screen keyart">
      <img src={import.meta.env.BASE_URL + 'assets/menu.jpg'} className="menu-bg" alt="" />
      <div className="menu-bg-shade" />
      <div className="menu-drone menu-drone-l" aria-hidden="true"><img src={import.meta.env.BASE_URL + 'assets/drone.png'} alt="" /></div>
      <div className="menu-drone menu-drone-r" aria-hidden="true"><img src={import.meta.env.BASE_URL + 'assets/drone.png'} alt="" /></div>
      <EmberFX />
      <button className="menu-close" aria-label="Close" onClick={() => { playClick(); window.close(); setTimeout(() => { location.href = 'about:blank' }, 150) }}>✕</button>
      <div className="keyart-ui">
        <button className="battle-btn" onClick={() => { playClick(); onStart() }}>BATTLE!</button>
        <button ref={optionsButtonRef} className="battle-btn battle-btn-gray" onClick={() => { playClick(); setOptions(true) }}>OPTIONS</button>
        <OptionsDialog open={options} settings={settings} onSettings={onSettings} playClick={playClick}
          onClose={() => { if (options) { setOptions(false); optionsButtonRef.current?.focus() } }} />
        <button className="battle-btn battle-btn-gold" onClick={() => { playClick(); onHiScores() }}>HI-SCORE</button>
        <p className="menu-foot">Network Centric Warfare v1.0</p>
      </div>
    </div>
  )
}

function ReplayScreen({ onReplay, onMenu, continues }) {
  return (
    <div className="screen gameover continue-screen" role="dialog" aria-modal="true" aria-labelledby="mission-over-heading">
      <div className="continue-panel">
        <p className="continue-eyebrow">TANK COMMANDER</p>
        <h1 id="mission-over-heading">TANK DESTROYED</h1>
        <ContinueStars remaining={continues} />
        <p className="continue-description">{continues > 0 ? `${continues} CONTINUES REMAINING — RETURN TO THE BATTLE` : 'NO CONTINUES REMAINING'}</p>
        <div className="row">
          {continues > 0 && <button className="btn" autoFocus onClick={() => { playClick(); onReplay() }}>REPLAY</button>}
          <button className="btn ghost" autoFocus={continues === 0} onClick={() => { playClick(); onMenu() }}>MAIN MENU</button>
        </div>
      </div>
      <EmberFX />
    </div>
  )
}

function WinScreen({ stats, onReplay, onMenu, onHiScores, onSaved }) {
  const [eligible] = useState(() => qualifies(stats.score))
  const [name, setName] = useState(lastName)
  const [rank, setRank] = useState(0)
  const save = (e) => {
    e.preventDefault()
    if (!name.trim() || rank) return
    playClick()
    const r = addScore({ name, score: stats.score, time: stats.time, map: stats.map })
    setRank(r.rank)
    onSaved(r.id)
  }
  return (
    <div className="screen win">
      <h1 className="title green">YOU WIN</h1>
      <p className="subtitle">All enemy AI tanks destroyed.</p>
      <div className="stats">
        <div className="stat"><span>SCORE</span><b>{stats.score.toLocaleString()}</b></div>
        <div className="stat"><span>TIME</span><b>{formatTime(stats.time)}</b></div>
        <div className="stat"><span>SHOTS FIRED</span><b>{stats.shots}</b></div>
        <div className="stat"><span>ACCURACY</span><b>{stats.accuracy}%</b></div>
        <div className="stat"><span>HITS</span><b>{stats.hits}</b></div>
        <div className="stat"><span>WRECKS CRUSHED</span><b>+{(stats.bonus || 0).toLocaleString()}</b></div>
      </div>
      {!rank && (
        <form className="hs-form" onSubmit={save}>
          <label htmlFor="hs-name">{eligible ? 'NEW HI-SCORE! ENTER YOUR NAME' : 'ENTER YOUR NAME'}</label>
          <div className="row">
            <input id="hs-name" value={name} maxLength={NAME_MAX} autoFocus autoComplete="nickname" spellCheck={false}
              placeholder="COMMANDER" onChange={(e) => setName(e.target.value)} />
            <button className="btn" type="submit" disabled={!name.trim()}>SAVE</button>
          </div>
        </form>
      )}
      {rank > 0 && <p className="hs-rank">SAVED — RANK #{rank}{rank <= MAX_SCORES ? ' · TOP 10!' : ''}</p>}
      <div className="row">
        <button className="btn" onClick={() => { playClick(); onReplay() }}>REPLAY</button>
        <button className="btn ghost" onClick={() => { playClick(); onHiScores() }}>HI-SCORE</button>
        <button className="btn ghost" onClick={() => { playClick(); onMenu() }}>MAIN MENU</button>
      </div>
      <EmberFX />
    </div>
  )
}

function HiScoreScreen({ onBack, highlight }) {
  // read once on mount: the board, plus the player's own standing (just-saved entry, else best under the last name)
  const [{ top, me }] = useState(() => {
    const all = loadAll()
    return { top: all.slice(0, MAX_SCORES), me: standing(all, highlight, lastName()) }
  })
  const row = (s, rank, cls) => (
    <tr key={s.id} className={cls}>
      <td>{rank}</td><td>{s.name}</td><td>{s.score.toLocaleString()}</td>
      <td>{formatTime(s.time)}</td><td>{(s.map || '—').toUpperCase()}</td>
      <td>{new Date(s.date).toLocaleDateString()}</td>
    </tr>
  )
  return (
    <div className="screen win hiscore-screen">
      <h1 className="title green">HI-SCORE</h1>
      <p className="subtitle">TOP 10 COMMANDERS</p>
      <div className="hs-wrap">
        <table className="hs-table">
          <thead><tr><th>#</th><th>NAME</th><th>SCORE</th><th>TIME</th><th>MAP</th><th>DATE</th></tr></thead>
          <tbody>
            {Array.from({ length: MAX_SCORES }, (_, i) => top[i]
              ? row(top[i], i + 1, top[i].id === me?.entry.id ? 'hs-new' : undefined)
              : <tr key={`empty-${i}`} className="hs-empty"><td>{i + 1}</td><td>— — —</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>)}
          </tbody>
          {me && me.rank > MAX_SCORES && <tfoot>{row(me.entry, me.rank, 'hs-new hs-me')}</tfoot>}
        </table>
      </div>
      <button className="btn ghost" autoFocus onClick={() => { playClick(); onBack() }}>BACK</button>
      <EmberFX />
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState('menu') // menu | game | gameover | win
  const [stats, setStats] = useState({ time: 0, shots: 0, hits: 0, accuracy: 0 })
  const [gameKey, setGameKey] = useState(0)
  const [continues, setContinues] = useState(3)
  const [map, setMap] = useState('random')
  const [resumeCount, setResumeCount] = useState(0)
  const introRef = useRef(null)
  const [newScoreId, setNewScoreId] = useState(null)
  const [settings, setSettings] = useState(loadSettings)
  const updateSettings = (patch) => setSettings((s) => { const next = { ...s, ...patch }; saveSettings(next); return next })

  // warm the game chunk in the background so BATTLE starts instantly
  useEffect(() => {
    const warm = () => { import('./Game') }
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(warm)
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(warm, 2000)
    return () => clearTimeout(t)
  }, [])

  // intro music on menu screens (starts on first user gesture — browser policy)
  useEffect(() => {
    if (!introRef.current) {
      introRef.current = new Audio(introUrl)
      introRef.current.loop = true
    }
    introRef.current.volume = 0.45 * channelVolume(settings, 'music')
    const a = introRef.current
    if (screen === 'menu' || screen === 'mapselect' || screen === 'hiscores') {
      const kick = () => a.play().catch(() => {})
      kick()
      window.addEventListener('pointerdown', kick, { once: true })
      window.addEventListener('keydown', kick, { once: true })
      return () => {
        window.removeEventListener('pointerdown', kick)
        window.removeEventListener('keydown', kick)
      }
    } else {
      a.pause()
    }
  }, [screen, settings])

  const handleEnd = useCallback((result) => {
    if (result.win) {
      setStats({ ...result.stats, score: calcScore(result.stats) })
      setScreen('win')
    } else {
      setContinues((count) => Math.max(0, count - 1))
      setScreen('gameover')
    }
  }, [])

  const start = (m = map) => {
    trackPlay(m)
    setGameKey((key) => key + 1)
    setContinues(3)
    setResumeCount(0)
    setScreen('game')
    // auto fullscreen on mission start (user gesture required — this is a click)
    const lockLandscape = () => {
      if (matchMedia('(pointer: coarse)').matches) window.screen.orientation?.lock?.('landscape').catch(() => {})
    }
    // re-requesting while already fullscreen eats the click's user activation in Windows
    // Chrome, so the new battle's pointer lock request fails and the mouse stops working
    if (document.fullscreenElement) { lockLandscape(); return }
    const fullscreen = document.documentElement.requestFullscreen?.()
    if (fullscreen) fullscreen.then(lockLandscape).catch(lockLandscape)
    else lockLandscape()
  }
  const replay = () => {
    if (screen !== 'gameover' || continues <= 0) return
    setResumeCount((count) => count + 1)
    setScreen('game')
  }
  const toMenu = () => setScreen('menu')
  const pickMap = (m) => { setMap(m); start(m) }

  return (
    <div className="app">
      <div className="rotate-device"><b>ROTATE YOUR DEVICE</b><p>หมุนเครื่องเป็นแนวนอนเพื่อเล่น</p></div>
      {screen === 'menu' && <StartScreen onStart={() => setScreen('mapselect')} onHiScores={() => { setNewScoreId(null); setScreen('hiscores') }} settings={settings} onSettings={updateSettings} />}
      {screen === 'hiscores' && <HiScoreScreen onBack={toMenu} highlight={newScoreId} />}
      {screen === 'mapselect' && <MapSelect onPick={pickMap} onBack={toMenu} />}
      {(screen === 'game' || screen === 'gameover') && (
        <Suspense fallback={<div className="screen"><p className="subtitle">DEPLOYING…</p></div>}>
          <Game key={gameKey} onEnd={handleEnd} onExit={toMenu} resumeCount={resumeCount} inactive={screen === 'gameover'} map={map}
            settings={settings} onSettings={updateSettings} playClick={playClick} />
        </Suspense>
      )}
      {screen === 'gameover' && <ReplayScreen onReplay={replay} onMenu={toMenu} continues={continues} />}
      {screen === 'win' && <WinScreen stats={stats} onReplay={() => start()} onMenu={toMenu} onHiScores={() => setScreen('hiscores')} onSaved={setNewScoreId} />}
    </div>
  )
}
