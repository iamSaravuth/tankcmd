import { useEffect, useRef, useState, useCallback } from 'react'
import { TankGame, RELOAD_TIME, MG_COOL } from './game/TankGame'
import Minimap from './components/Minimap'

export default function Game({ onEnd, onExit, resumeCount, inactive, map }) {
  const mountRef = useRef(null)
  const gameRef = useRef(null)
  const reloadFillRef = useRef(null)
  const reloadLabelRef = useRef(null)
  const mgFillRef = useRef(null)
  const mgLabelRef = useRef(null)
  const reticleRef = useRef(null)
  const crosshairRef = useRef(null)
  const scopeRef = useRef(null)
  const zoomButtonRef = useRef(null)
  const [hud, setHud] = useState({ hp: 100, maxHp: 100, kills: 0, total: 3 })
  const [showMap, setShowMap] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [arcs, setArcs] = useState([])
  const seenArcs = useRef(new Set())

  const [mobile] = useState(() => matchMedia('(pointer: coarse)').matches)
  const stickRef = useRef(null)
  const aimRef = useRef(null)
  const clearInput = () => {
    const g = gameRef.current
    if (g) { g.keys = {}; g.touchDrive = null; g.mgTouch = false; g.player.zoom = false }
    if (stickRef.current) stickRef.current.style.transform = ''
    aimRef.current = null
  }
  const pause = () => {
    clearInput()
    if (gameRef.current) gameRef.current.paused = true
    document.exitPointerLock?.()
    setConfirmQuit(true)
  }
  const drive = (e) => {
    const g = gameRef.current
    if (!g || g.paused || g.over) return
    const rect = e.currentTarget.getBoundingClientRect()
    let x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2)
    let y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2)
    const length = Math.max(1, Math.hypot(x, y))
    x /= length; y /= length
    g.touchDrive = { forward: Math.abs(y) > 0.15 ? -y : 0, turn: Math.abs(x) > 0.15 ? -x : 0 }
    stickRef.current.style.transform = `translate(${x * 32}px, ${y * 32}px)`
  }
  const releaseDrive = () => {
    if (gameRef.current) gameRef.current.touchDrive = null
    if (stickRef.current) stickRef.current.style.transform = ''
  }
  const aim = (e) => {
    const g = gameRef.current, last = aimRef.current
    if (!last || last.id !== e.pointerId || !g || g.paused || g.over) return
    g.aimTurret(e.clientX - last.x, e.clientY - last.y, true)
    aimRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onHud = useCallback((h) => setHud({ ...h }), [])

  // attack-direction arcs: collect new entries from hud updates, drop after fade
  useEffect(() => {
    for (const a of hud.hitArcs || []) {
      if (seenArcs.current.has(a.id)) continue
      seenArcs.current.add(a.id)
      setArcs((list) => [...list, a])
      setTimeout(() => setArcs((list) => list.filter((x) => x.id !== a.id)), 1650)
    }
  }, [hud])

  useEffect(() => {
    const game = new TankGame(mountRef.current, onHud, onEnd, map)
    gameRef.current = game
    game.start()
    // the map-pick click is still a user gesture: lock the mouse right away so aiming works without an extra click
    if (!mobile) game.renderer.domElement.requestPointerLock()?.catch?.(() => {})

    let raf
    const tick = () => {
      const g = gameRef.current
      if (g && g.player && reloadFillRef.current) {
        if (scopeRef.current) scopeRef.current.hidden = !g.player.zoom || g.paused || g.over
        zoomButtonRef.current?.setAttribute('aria-pressed', String(g.player.zoom))
        const frac = 1 - Math.min(g.player.cooldown / RELOAD_TIME, 1)
        reloadFillRef.current.style.width = `${frac * 100}%`
        reloadFillRef.current.style.background = frac >= 1 ? '#4fe07a' : '#d8a03c'
        if (reloadLabelRef.current) {
          reloadLabelRef.current.textContent = frac >= 1 ? 'READY' : `${g.player.cooldown.toFixed(1)}s`
        }
        if (mgFillRef.current) {
          const heat = g.player.mgHeat || 0, over = g.player.mgOver
          mgFillRef.current.style.width = `${heat * 100}%`
          mgFillRef.current.style.background = over ? '#e04434' : heat > 0.7 ? '#d8a03c' : '#cfd6c8'
          if (mgLabelRef.current) mgLabelRef.current.textContent = over ? `${(heat * MG_COOL).toFixed(1)}s` : heat > 0.01 ? `${Math.round(heat * 100)}%` : 'READY'
        }
        if (reticleRef.current) {
          // dispersion ring: 30px tight -> 110px fully bloomed; red while reloading
          const size = 30 + g.player.dispersion * 80
          reticleRef.current.style.width = reticleRef.current.style.height = `${size}px`
          reticleRef.current.style.borderColor = g.player.cooldown > 0 ? 'rgba(216,160,60,.9)' : 'rgba(79,224,122,.85)'
        }
        // ring tracks the barrel's hit point, crosshair tracks the mouse aim point
        const at = (o) => `translate(-50%,-50%) translate(${o?.x ?? 0}px, ${o?.y ?? 0}px)`
        if (reticleRef.current) reticleRef.current.style.transform = at(g.reticleOffset)
        if (crosshairRef.current) crosshairRef.current.style.transform = at(g.crosshairOffset)
        // last-kill hold shot: clean frame, no aiming marks
        const vis = g.victory ? 'hidden' : ''
        if (reticleRef.current) reticleRef.current.style.visibility = vis
        if (crosshairRef.current) crosshairRef.current.style.visibility = vis
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onKey = (e) => {
      if (e.code === 'KeyM') setShowMap((s) => !s)
      if (e.code === 'Escape' && !game.over) {
        game.keys = {}; game.touchDrive = null; game.mgTouch = false; game.player.zoom = false
        game.paused = true; setConfirmQuit(true)
      }
    }
    // ESC while pointer-locked releases the lock first — treat that as pause too
    // only a lock this canvas actually held counts — unlock events from a previous
    // game instance (e.g. React StrictMode remount) or a refused request must not pause
    let hadLock = false
    const onLockChange = () => {
      if (document.pointerLockElement === game.renderer.domElement) { hadLock = true; return }
      if (!hadLock) return
      hadLock = false
      if (!game.over) {
        game.paused = true
        setConfirmQuit(true)
      }
    }
    const suspend = () => {
      game.keys = {}; game.touchDrive = null; game.mgTouch = false; game.player.zoom = false
      aimRef.current = null
      if (stickRef.current) stickRef.current.style.transform = ''
      if (!game.over) { game.paused = true; setConfirmQuit(true) }
    }
    const visibility = () => { if (document.hidden) suspend() }
    const rotate = () => { if (mobile && window.innerHeight > window.innerWidth) suspend() }
    window.addEventListener('blur', suspend)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', rotate)
    rotate()
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('blur', suspend)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('resize', rotate)
      game.dispose()
    }
  }, [onEnd, onHud, mobile, map])

  useEffect(() => {
    if (resumeCount > 0 && gameRef.current?.revivePlayer()) {
      setConfirmQuit(false)
      setShowMap(false)
      aimRef.current = null
      if (stickRef.current) stickRef.current.style.transform = ''
    }
  }, [resumeCount])

  const resume = () => {
    setConfirmQuit(false)
    const g = gameRef.current
    if (g) {
      clearInput()
      g.paused = false
      if (!mobile) g.renderer.domElement.requestPointerLock()?.catch(() => {})
    }
  }

  const hpPct = (hud.hp / hud.maxHp) * 100

  return (
    <div className={`game-wrap${mobile ? ' mobile-game' : ''}`} inert={inactive}>
      <div ref={mountRef} className="canvas-mount" />
      <div ref={scopeRef} className="sniper-scope" hidden aria-hidden="true">
        <svg viewBox="0 0 1000 1000" className="scope-lines">
          <g fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M0 500H440 M560 500H1000 M500 0V440 M500 560V1000 M480 500H520 M500 480V520" />
            {[-3, -2, -1, 1, 2, 3].map((n) => <g key={n}>
              <path d={`M${500 + n * 115} 500v48 M${500 + n * 115 - 57.5} 500v24`} />
            </g>)}
            {Array.from({ length: 20 }, (_, i) => {
              const y = 525 + i * 18, major = (i + 1) % 5 === 0
              return <path key={i} d={`M552 ${y}h${major ? 42 : 27} M448 ${y}h${major ? -42 : -27}`} />
            })}
          </g>
          <g fill="currentColor" fontFamily="Arial, sans-serif" fontSize="24" textAnchor="middle">
            {[-3, -2, -1, 1, 2, 3].map((n) => <text key={n} x={500 + n * 115} y="483">{Math.abs(n) * 20}</text>)}
            {[5, 10, 15, 20].map((n) => <text key={n} x="620" y={525 + (n - 1) * 18 + 8}>{n}</text>)}
          </g>
        </svg>
      </div>
      {mobile && <>
        <div className="touch-aim" onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          if (!aimRef.current) aimRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        }} onPointerMove={aim} onPointerUp={(e) => { if (aimRef.current?.id === e.pointerId) aimRef.current = null }} onPointerCancel={() => { aimRef.current = null }} />
        <div className="touch-stick" role="group" aria-label="Drive joystick" onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId); drive(e)
        }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) drive(e) }} onPointerUp={releaseDrive} onPointerCancel={releaseDrive} onLostPointerCapture={releaseDrive}>
          <span ref={stickRef} />
        </div>
        <button className="touch-fire" aria-label="Fire cannon" onPointerDown={(e) => {
          e.preventDefault()
          const g = gameRef.current
          if (g && !g.paused && !g.over) g.firePlayer()
        }}>FIRE</button>
        <button className="touch-zoom touch-mg" aria-label="Hold to fire coaxial machine gun" onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          if (gameRef.current) gameRef.current.mgTouch = true
        }} onPointerUp={() => { if (gameRef.current) gameRef.current.mgTouch = false }}
          onPointerCancel={() => { if (gameRef.current) gameRef.current.mgTouch = false }}
          onLostPointerCapture={() => { if (gameRef.current) gameRef.current.mgTouch = false }}>MG</button>
        <button ref={zoomButtonRef} className="touch-zoom" aria-label="Toggle sniper zoom" aria-pressed="false" onClick={() => {
          const g = gameRef.current
          if (g && !g.paused && !g.over) g.player.zoom = !g.player.zoom
        }}>AIM</button>
        <div className="mobile-toolbar">
          <button onClick={() => setShowMap((s) => !s)} aria-label="Toggle minimap">MAP</button>
          <button onClick={pause} aria-label="Exit game" title="Exit game">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 4H4v16h6 M9 12h12 M17 8l4 4-4 4" />
            </svg>
          </button>
        </div>
      </>}
      <div ref={crosshairRef} className="crosshair">+</div>
      <div ref={reticleRef} className="reticle" />
      {arcs.map((a) => (
        <svg key={a.id} className="hit-arc" viewBox="0 0 260 260"
          style={{ transform: `translate(-50%, -50%) rotate(${a.rel}rad)` }}>
          <path d="M 89.9 43.9 A 95 95 0 0 1 170.1 43.9" fill="none" />
        </svg>
      ))}
      <div className="hud">
        <div className="hud-box hp-wide">
          <span className="hud-label">HP</span>
          <div className="hp-track">
            <div className="hp-fill" style={{ width: `${hpPct}%`, background: hpPct > 40 ? '#4fe07a' : '#e04434' }} />
            <span className="hp-num">{hud.hp}</span>
          </div>
        </div>
        <div className="hud-box"><span className="hud-label">AMMO</span><b>∞</b></div>
        {hud.apT > 0 && <div className="hud-box ap-badge"><span>AP ×2</span><b>{hud.apT}s</b></div>}
        <div className="hud-box"><span className="hud-label">KILLS</span><b>{hud.kills}/{hud.total}</b></div>
        <div className="hud-box"><span className="hud-label">MAP</span><b style={{textTransform:'uppercase'}}>{hud.theme || '—'}</b></div>
        <div className="hud-box hint">M — MAP</div>
      </div>
      <div className="reload-wrap">
        <span className="hud-label">LOAD</span>
        <div className="reload-track"><div ref={reloadFillRef} className="reload-fill" /></div>
        <span ref={reloadLabelRef} className="reload-label">READY</span>
      </div>
      <div className="reload-wrap mg-wrap">
        <span className="hud-label">MG</span>
        <div className="reload-track"><div ref={mgFillRef} className="reload-fill" style={{ width: 0 }} /></div>
        <span ref={mgLabelRef} className="reload-label">READY</span>
      </div>
      <div className="control-guide">
        {mobile ? (
          <><span>Stick drive</span><span>Drag aim</span><span>FIRE</span><span>MG / Space hold</span><span>AIM zoom</span><span>MAP</span></>
        ) : (
          <><span>W/S drive</span><span>A/D hull</span><span>Mouse turret</span>
          <span>LMB fire</span><span>Space MG</span><span>RMB sniper</span><span>Wheel zoom</span>
          <span>M map</span><span>ESC menu</span></>
        )}
        <span className="sep" />
        <span>HP 100</span><span>Ammo ∞</span><span>Reload 5s</span><span>50 km/h</span>
      </div>
      {showMap && <Minimap game={gameRef} onClose={() => setShowMap(false)} />}
      {confirmQuit && (
        <div className="quit-overlay">
          <div className="quit-box">
            <h2>EXIT GAME?</h2>
            <p>Return to main menu?</p>
            <div className="row">
              <button className="btn" onClick={resume}>RESUME</button>
              <button className="btn ghost" onClick={onExit}>EXIT TO MENU</button>
            </div>
          </div>
        </div>
      )}
      {!mobile && <div className="lock-hint">Click the screen to lock mouse control</div>}
    </div>
  )
}
