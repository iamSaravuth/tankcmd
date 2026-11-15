import { useEffect, useRef } from 'react'

const BASE = 420 // drawing units; the canvas is scaled up to fill the screen

export default function Minimap({ game, onClose }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    let raf
    const draw = () => {
      const g = game.current
      const cv = canvasRef.current
      if (g && cv) {
        const ctx = cv.getContext('2d')
        const S = BASE
        const k = cv.width / BASE
        ctx.setTransform(k, 0, 0, k, 0, 0)
        ctx.clearRect(0, 0, S, S)
        // terrain
        ctx.drawImage(g.minimapImage, 0, 0, S, S)
        const toMap = (x, z) => [((x + g.half) / (g.half * 2)) * S, ((z + g.half) / (g.half * 2)) * S]
        for (const d of g.drops) {
          const [x, y] = toMap(d.x, d.z)
          ctx.save()
          ctx.translate(x, y)
          ctx.strokeStyle = d.type === 'hp' ? '#b9f078' : '#ffd28b'
          ctx.fillStyle = '#101610e8'; ctx.lineWidth = 1.5
          ctx.setLineDash([2, 3])
          ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = ctx.strokeStyle
          ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(d.type === 'hp' ? '+' : 'AP', 0, 0)
          ctx.restore()
        }
        // enemies
        for (const e of g.enemies) {
          if (!e.alive) continue
          const [x, y] = toMap(e.mesh.position.x, e.mesh.position.z)
          ctx.fillStyle = '#ff2b2b'
          ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = '#fff'; ctx.stroke()
        }
        // kamikaze drones in flight
        for (const d of g.drones || []) {
          if (d.state !== 'fly') continue
          const [x, y] = toMap(d.mesh.position.x, d.mesh.position.z)
          ctx.fillStyle = '#ff8a1c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke()
        }
        // player
        const [px, py] = toMap(g.player.mesh.position.x, g.player.mesh.position.z)
        ctx.fillStyle = '#39d353'
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
        // facing
        const dx = Math.sin(g.player.yaw), dz = Math.cos(g.player.yaw)
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + dx * 16, py + dz * 16)
        ctx.strokeStyle = '#39d353'; ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [game])

  return (
    <div className="minimap-overlay" role="dialog" aria-label="Tactical map" onClick={onClose}>
      <h3>TACTICAL MAP <small>M / TAP TO CLOSE</small></h3>
      <canvas ref={canvasRef} width={1200} height={1200} />
      <div className="legend">
        <span className="dot green" /> You &nbsp;&nbsp;<span className="dot red" /> Enemy AI
        <br /><span className="drop-hp">⊕ HP drop</span> &nbsp; <span className="drop-ap">AP Ammo drop</span>
      </div>
    </div>
  )
}
