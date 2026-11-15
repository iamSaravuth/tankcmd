import { useEffect, useRef, useState, useCallback } from 'react'
import { TankGame, RELOAD_TIME, MG_COOL } from './game/TankGame'
import Minimap from './components/Minimap'
import OptionsDialog from './components/OptionsDialog'

export default function Game({ onEnd, onExit, resumeCount, inactive, map, settings, onSettings, playClick }) {
  const mountRef = useRef(null)
  const gameRef = useRef(null)
  const reloadFillRef = useRef(null)
  const reloadLabelRef = useRef(null)
  const mgFillRef = useRef(null)
  const mgLabelRef = useRef(null)
  const gearRef = useRef(null)
  const droneWarnRef = useRef(null)
  const droneDistRef = useRef(null)
  const droneSightRef = useRef(null)
  const droneEtaRef = useRef(null)
  const reticleRef = useRef(null)
  const crosshairRef = useRef(null)
  const scopeRef = useRef(null)
  const zoomButtonRef = useRef(null)
  const [hud, setHud] = useState({ hp: 100, maxHp: 100, kills: 0, total: 3 })
  const [showMap, setShowMap] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const optionsButtonRef = useRef(null)
  const [arcs, setArcs] = useState([])
  const seenArcs = useRef(new Set())

  const [mobile] = useState(() => matchMedia('(pointer: coarse)').matches)
  const stickRef = useRef(null)
  const aimRef = useRef(null)
  const clearInput = () => {
    const g = gameRef.current
    if (g) { g.keys = {}; g.touchDrive = null; g.mgTouch = false; g.player.zoom = false; g.player.fireQueued = false }
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
        if (droneWarnRef.current) {
          const w = !g.paused && !g.over && g.droneWarn
          const def = !!(w && w.defense)
          droneWarnRef.current.hidden = !w || def
          if (w && droneDistRef.current) droneDistRef.current.textContent = `${Math.round(w.dist)} m`
          if (droneSightRef.current) droneSightRef.current.hidden = !def
          if (def && droneEtaRef.current) droneEtaRef.current.textContent = `${Math.round(w.dist)} m · ${w.eta.toFixed(1)}s`
        }
        if (gearRef.current) {
          const v = g.player.vel || 0
          gearRef.current.textContent = `${v < -0.3 ? 'R' : Math.abs(v) < 0.3 ? 'N' : g.player.gear} · ${Math.round(Math.abs(v) * 3.6)} km/h`
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

    // Tab toggles the EXIT GAME? menu (inside the Options dialog Tab keeps moving focus)
    const onKey = (e) => {
      if (e.code === 'KeyM') setShowMap((s) => !s)
      if (e.code !== 'Tab' || e.repeat || game.over || e.target.closest?.('dialog')) return
      e.preventDefault()
      game.keys = {}; game.touchDrive = null; game.mgTouch = false; game.player.zoom = false; game.player.fireQueued = false
      if (game.paused) { // same as RESUME
        setConfirmQuit(false); setShowOptions(false)
        game.paused = false
        if (!mobile) game.renderer.domElement.requestPointerLock()?.catch(() => {})
        return
      }
      game.paused = true; setConfirmQuit(true)
      document.exitPointerLock?.()
    }
    // the browser always releases the pointer lock on ESC (that can't be overridden);
    // losing the lock no longer pauses — the game keeps running, the turret follows the
    // free cursor over the canvas and the next click re-locks. Blur while the battle is
    // still loading must not open EXIT GAME? either
    const startedAt = performance.now()
    const starting = () => performance.now() - startedAt < 3000
    const suspend = () => {
      game.keys = {}; game.touchDrive = null; game.mgTouch = false; game.player.zoom = false
      aimRef.current = null
      if (stickRef.current) stickRef.current.style.transform = ''
      if (!game.over) { game.paused = true; setConfirmQuit(true) }
    }
    const visibility = () => { if (document.hidden) suspend() }
    const rotate = () => { if (mobile && window.innerHeight > window.innerWidth) suspend() }
    const onBlur = () => { if (starting()) game.keys = {}; else suspend() }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', rotate)
    rotate()
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
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

  // volume sliders in the pause Options take effect on the running battle
  useEffect(() => { if (settings) gameRef.current?.applySettings(settings) }, [settings])

  const resume = () => {
    setConfirmQuit(false)
    setShowOptions(false)
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
          <button onClick={() => gameRef.current?.resetTurret()} aria-label="Reset turret to front" title="Reset turret">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12a8 8 0 1 0 2.4-5.7 M4 4v4h4 M12 8v5" />
            </svg>
          </button>
          <button onClick={pause} aria-label="Exit game" title="Exit game">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 4H4v16h6 M9 12h12 M17 8l4 4-4 4" />
            </svg>
          </button>
        </div>
      </>}
      <div ref={crosshairRef} className="crosshair">+</div>
      <div ref={reticleRef} className="reticle" />
      <div ref={droneSightRef} className="drone-sight" hidden aria-hidden="true">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="500" cy="500" r="150" /><circle cx="500" cy="500" r="300" strokeDasharray="14 22" />
            <path d="M500 310v120 M500 570v120 M310 500h120 M570 500h120" />
            {[-2, -1, 1, 2].map((n) => <path key={n} d={`M${500 + n * 75} 486v28 M486 ${500 + n * 75}h28`} />)}
          </g>
          <g fill="none" stroke="currentColor" strokeWidth="4">
            <path d="M120 120h90 M120 120v90 M880 120h-90 M880 120v90 M120 880h90 M120 880v-90 M880 880h-90 M880 880v-90" />
          </g>
        </svg>
        <div className="drone-sight-top">DRONE DEFENSE · MG <b ref={droneEtaRef}>0 m</b></div>
        <div className="drone-sight-hint">SPACE / LMB — shoot it down</div>
      </div>
      <div ref={droneWarnRef} className="drone-warn" role="alert" hidden>
        <svg viewBox="0 0 64 56" aria-hidden="true"><path d="M32 3 L61 53 H3 Z" fill="#e0201a" stroke="#fff" strokeWidth="3" strokeLinejoin="round" /><rect x="29" y="18" width="6" height="20" rx="2" fill="#fff" /><circle cx="32" cy="45" r="3.5" fill="#fff" /></svg>
        <span>DRONE <b ref={droneDistRef}>0 m</b></span>
      </div>
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
        <div className="hud-box"><span className="hud-label">GEAR</span><b ref={gearRef} className="gear-val">N · 0 km/h</b></div>
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
          <><span>Stick drive</span><span>Drag aim</span><span>FIRE</span><span>MG / Space hold</span><span>AIM zoom</span><span>MAP</span><span>↺ turret</span></>
        ) : (
          <><span>W/S drive</span><span>A/D hull</span><span>Mouse turret</span>
          <span>LMB fire</span><span>Space MG</span><span>RMB sniper</span><span>Wheel zoom</span>
          <span>R turret front</span><span>M map</span><span>Tab menu</span></>
        )}
        <span className="sep" />
        <span>HP 100</span><span>Ammo ∞</span><span>Reload 5s</span><span>65 km/h</span>
      </div>
      {showMap && <Minimap game={gameRef} onClose={() => setShowMap(false)} />}
      {confirmQuit && (
        <div className="quit-overlay">
          <div className="quit-box" hidden={showOptions}>
            <h2>EXIT GAME?</h2>
            <p>Return to main menu?</p>
            <div className="row">
              <button className="btn" onClick={resume}>RESUME</button>
              <button ref={optionsButtonRef} className="btn ghost" onClick={() => { playClick?.(); setShowOptions(true) }}>OPTIONS</button>
              <button className="btn ghost" onClick={onExit}>EXIT TO MENU</button>
            </div>
          </div>
        </div>
      )}
      {confirmQuit && settings && (
        <OptionsDialog open={showOptions} settings={settings} onSettings={onSettings} playClick={playClick ?? (() => {})}
          onClose={() => { if (showOptions) { setShowOptions(false); setTimeout(() => optionsButtonRef.current?.focus()) } }} />
      )}
      {!mobile && <div className="lock-hint">Click the screen to lock mouse control</div>}
    </div>
  )
}
