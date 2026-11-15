import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SoundFX } from './sfx.js'
import { EnvironmentMaterials } from './EnvironmentMaterials.js'
import { pineGeometry, oakGeometry, buildCoastalOutpost } from './BattlefieldDetails.js'
import bgUrl from '../assets/bg.mp3'
import { loadSettings, channelVolume } from '../settings.js'

const WORLD_HALF = 540          // 3x larger map
const WATER_LEVEL = 0.0
const MAX_HP = 100              // equal HP for player & AI
export const RELOAD_TIME = 5    // seconds — no continuous fire
const SPEED = 14                // ~50 km/h
const DMG_PLAYER = 34           // player shell damage vs AI
// coaxial MG: unlimited ammo, 20 rounds = 1 cannon shell, overheats after a 20-round burst
const MG_ROUNDS_PER_SHELL = 20
const MG_DMG = DMG_PLAYER / MG_ROUNDS_PER_SHELL
const MG_RATE = 10              // rounds / second
const MG_SPEED = 320
export const MG_COOL = RELOAD_TIME // forced cool-down after overheating = cannon reload
// player aiming (WoT-style: the view orbits freely 360°, the turret slews after it
// the short way round): traverse / elevation speed (rad/s), elevation limits
// (+ = barrel down), mouse / touch sensitivity (rad per px at 100%), fire buffer (s)
const TRAVERSE = 1.6, ELEVATE = 0.6
const PITCH_UP = -0.5, PITCH_DOWN = 0.3
const MOUSE_SENS = 0.0022, TOUCH_SENS = 0.0045
const FIRE_BUFFER = 0.5
// player drivetrain: automatic 3-speed box — top speed of each gear (fraction of
// the tank's top speed) and its acceleration (m/s²); the power cuts briefly per shift
const GEARS = [{ top: 0.3, acc: 3.2 }, { top: 0.62, acc: 2.4 }, { top: 1, acc: 1.6 }]
const TOP_SPEED = 1.3           // x SPEED -> ~65 km/h in 3rd
const REVERSE_TOP = 0.3, REVERSE_ACC = 2.5
const SHIFT_TIME = 0.45, COAST_DECEL = 2.5, BRAKE_DECEL = 12
// last kill: hold a slightly elevated shot of the final wreck before the win screen
const VICTORY_HOLD = 10         // seconds
const VICTORY_DIST = 24
const VICTORY_HEIGHT = 9
// enemy kamikaze drones: count per map (difficulty), cruise speed (m/s), altitude,
// on-screen warning radius (m), impact radius (m); damage = one enemy cannon shell
const DRONES = { forest: 2, city: 3, snow: 5 }
const DRONE_SPEED = 30, DRONE_ALT = 35, DRONE_WARN = 160, DRONE_HIT = 4.5
// close-defence mode: the battle freezes at this range and the player shoots
// the incoming drone down over the MG sight; it closes at DEF_SLOW of normal speed
const DRONE_ENGAGE = 110, DEF_SLOW = 0.42, DEF_PITCH_UP = -1.15
// AI difficulty per map: reload/spread/speed are multipliers, dmg = shell damage vs player, range = firing range (m)
const AI_LEVELS = {
  forest: { reload: 1.4, spread: 1.6, speed: 0.85, dmg: 15, range: 200 }, // easy
  city: { reload: 1, spread: 1, speed: 1, dmg: 20, range: 260 },          // medium
  snow: { reload: 0.75, spread: 0.55, speed: 1.1, dmg: 26, range: 320 },  // hard
}

// ---- terrain height field ----
const HILLS = [
  { x: -220, z: -180, r: 120, h: 34 }, { x: 260, z: -260, r: 140, h: 42 },
  { x: 180, z: 220, r: 110, h: 30 }, { x: -320, z: 260, r: 100, h: 26 },
  { x: -60, z: -330, r: 130, h: 38 }, { x: 380, z: 60, r: 110, h: 30 },
  { x: -400, z: -40, r: 95, h: 24 }, { x: 60, z: 380, r: 120, h: 32 },
]
const LAKES = [
  { x: 0, z: -120, r: 80, d: 10 }, { x: -180, z: 110, r: 65, d: 9 },
  { x: 280, z: -40, r: 75, d: 10 }, { x: -60, z: 350, r: 60, d: 8 },
  { x: 140, z: 100, r: 55, d: 9 }, { x: -350, z: -260, r: 70, d: 9 },
  { x: 360, z: 300, r: 62, d: 8 },
]

function gauss(x, z, cx, cz, r) {
  const dx = x - cx, dz = z - cz
  return Math.exp(-(dx * dx + dz * dz) / (r * r))
}

// shell craters — real terrain depressions + raised rims
const CRATERS = []
// city map: near-flat urban ground with no hills or lakes
let cityFlat = false

export function heightAt(x, z) {
  let h
  if (cityFlat) {
    h = 4 + Math.sin(x * 0.012) * Math.cos(z * 0.014) * 0.6
  } else {
    h = 4 + Math.sin(x * 0.012) * Math.cos(z * 0.014) * 2.5
      + Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.045) * 0.8
    for (const k of HILLS) h += k.h * gauss(x, z, k.x, k.z, k.r)
    for (const k of LAKES) h -= k.d * gauss(x, z, k.x, k.z, k.r) * 1.6
  }
  h -= THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(z)), cityFlat ? 470 : 420, WORLD_HALF) * 28
  for (const c of CRATERS) {
    const dx = x - c.x, dz = z - c.z
    const d2 = dx * dx + dz * dz
    if (d2 > c.r * c.r * 6.5) continue
    const u = Math.sqrt(d2) / c.r
    // bowl + raised rim just past the bowl edge
    h += c.depth * (-Math.exp(-u * u * 2.2) + Math.exp(-((u - 1.15) ** 2) * 9) * 0.32)
  }
  return h
}

// winding dirt roads (WoT-map style routes)
const ROADS = [
  [[-30, 540], [10, 320], [-50, 120], [20, -80], [-20, -300], [10, -540]],
  [[-540, 60], [-300, 30], [-120, -20], [80, 10], [300, -60], [540, -40]],
]
function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}
function distToRoad(x, z) {
  let d = Infinity
  for (const rd of ROADS)
    for (let i = 0; i < rd.length - 1; i++)
      d = Math.min(d, distToSeg(x, z, rd[i][0], rd[i][1], rd[i + 1][0], rd[i + 1][1]))
  return d
}

let waterFrozen = false
const isWater = (x, z) => !waterFrozen && heightAt(x, z) < WATER_LEVEL + 0.4
// frozen water rides on the ice surface instead of the lakebed
const surfaceY = (x, z) => waterFrozen && heightAt(x, z) < WATER_LEVEL + 0.4 ? WATER_LEVEL + 0.05 : heightAt(x, z)

// ground height under a tank's footprint — max of 4 corners + clearance so
// wheels never sink into slopes
function groundY(x, z) {
  const o = 3.2
  return Math.max(
    surfaceY(x, z),
    surfaceY(x - o, z - o), surfaceY(x + o, z - o),
    surfaceY(x - o, z + o), surfaceY(x + o, z + o)
  ) + 0.15
}


// tanks are ~15 units long (a ~9.5 m MBT incl. gun): wrecked cars use the same units-per-metre
const CAR_SCALE = 1.6
const PLAYER_TANK_LEN = 15 // m48a5.glb long axis for the player
// police-wrecks.glb / barricade.glb: half the player M48A5's length
const WRECK_GLB_LEN = PLAYER_TANK_LEN * 0.5
// airdrop crates: 1.6-unit model scaled to half a tank length (~7.5 units)
const DROP_SCALE = (PLAYER_TANK_LEN * 0.5) / 1.6
const DROP_HALF = 0.8 * DROP_SCALE

// normalize a GLB into a game-ready tank group:
// scaled to targetLen on the long axis, ground-aligned, turret/gun nodes bound, tinted
function prepTankModel(proto, tint, targetLen) {
  const inner = proto.clone(true)
  inner.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(inner)
  const size = bb.getSize(new THREE.Vector3())
  const s = targetLen / Math.max(size.x, size.z)
  inner.scale.setScalar(s)
  inner.updateMatrixWorld(true)
  const bb2 = new THREE.Box3().setFromObject(inner)
  const ctr = bb2.getCenter(new THREE.Vector3())
  const wrap = new THREE.Group()
  inner.position.set(-ctr.x, -bb2.min.y, -ctr.z)

  // find turret/gun nodes — Sketchfab exports use many naming conventions
  const findNode = (re, skip = null) => {
    let best = null
    inner.traverse((o) => {
      if (o.name && re.test(o.name) && !(skip && skip.test(o.name)) && (!best || o.name.length < best.name.length)) best = o
    })
    return best
  }
  const turNode = inner.getObjectByName('turret') || findNode(/turret|tower/i, /interior|mg|small|interior/i)
  const gunNode = inner.getObjectByName('gun') || inner.getObjectByName('weapon') || findNode(/\bgun\b|cannon|barrel|\bweapon\b/i, /mg|m2hb|mount/i)
  const hullNode = inner.getObjectByName('hull') || findNode(/\bhull\b|body|chassis/i)

  // face the model toward +Z (our yaw convention): prefer the gun direction,
  // facing = the hull's long horizontal axis, signed toward the end the gun
  // reaches farthest past — a turret may be bound at any yaw, so node
  // positions alone are unreliable
  let fwd = null
  if (hullNode && gunNode) {
    const hs = new THREE.Box3().setFromObject(hullNode).getSize(new THREE.Vector3())
    const hc = new THREE.Box3().setFromObject(hullNode).getCenter(new THREE.Vector3())
    const gb = new THREE.Box3().setFromObject(gunNode)
    fwd = hs.x > hs.z
      ? (Math.abs(gb.max.x - hc.x) > Math.abs(gb.min.x - hc.x) ? Math.PI / 2 : -Math.PI / 2)
      : (Math.abs(gb.max.z - hc.z) > Math.abs(gb.min.z - hc.z) ? 0 : Math.PI)
  } else if (gunNode && turNode) {
    const gp = gunNode.getWorldPosition(new THREE.Vector3())
    const tp = turNode.getWorldPosition(new THREE.Vector3())
    const d = gp.sub(tp); d.y = 0
    if (d.length() > 0.01) fwd = Math.atan2(d.x, d.z)
  }
  if (fwd === null) fwd = size.x > size.z ? Math.PI / 2 : 0
  inner.rotation.y = -fwd
  inner.updateMatrixWorld(true)

  inner.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      if (o.material) {
        o.material = o.material.clone()
        if (o.material.color) o.material.color.multiply(tint)
        // hide scan/display props that are not part of the tank
        const tag = `${o.name} ${o.material.name || ''}`
        if (/floor|shadow|smoke|logo|backdrop|ground/i.test(tag)) o.visible = false
      }
    }
  })
  // optional stowage variant + invisible interior — keep the model lean
  for (const name of ['stuff-option-b', 'interior turret', 'interior hull']) {
    const n = inner.getObjectByName(name)
    if (n) n.visible = false
  }
  wrap.add(inner)
  inner.updateMatrixWorld(true)

  // turret traverse pivot: re-pivot the turret node at its own footprint center
  // so models with baked transforms still rotate around the turret ring.
  // pivot axes are aligned to world axes (parents may be rotated, e.g. Z-up exports)
  const mkPivot = (node, point) => {
    const pivot = new THREE.Group()
    pivot.position.copy(node.parent.worldToLocal(point))
    pivot.quaternion.copy(node.parent.getWorldQuaternion(new THREE.Quaternion())).invert()
    node.parent.add(pivot)
    pivot.updateWorldMatrix(true, false)
    pivot.attach(node)
    return pivot
  }
  if (turNode) {
    // turret ring center = turret bbox WITHOUT the barrel — including the gun
    // would push the pivot forward and swing the turret sideways on traverse
    const gunParts = new Set()
    if (gunNode) gunNode.traverse((g) => gunParts.add(g))
    const tb = new THREE.Box3()
    turNode.traverse((o) => { if (o.isMesh && !gunParts.has(o)) tb.expandByObject(o) })
    const tc = tb.getCenter(new THREE.Vector3())
    wrap.userData.turret = mkPivot(turNode, new THREE.Vector3(tc.x, tb.min.y + (tb.max.y - tb.min.y) * 0.12, tc.z))
    wrap.userData.turretBase = wrap.userData.turret.rotation.clone()
  }
  // gun elevation pivot at the mantlet (rear of the gun bounding box)
  if (gunNode) {
    const gb = new THREE.Box3().setFromObject(gunNode)
    const gc = gb.getCenter(new THREE.Vector3())
    const pivot = mkPivot(gunNode, new THREE.Vector3(gc.x, gc.y, gb.min.z + (gb.max.z - gb.min.z) * 0.12))
    wrap.userData.gun = pivot
    wrap.userData.gunBase = 0
  }
  return wrap
}

export class TankGame {
  constructor(mount, onHud, onEnd, map) {
    this.mount = mount
    this.onHud = onHud
    this.onEnd = onEnd
    this.half = WORLD_HALF
    this.mobile = matchMedia('(pointer: coarse)').matches
    this.settings = loadSettings()
    this.quality = this.settings.graphics // high | medium | low
    this.lite = this.mobile || this.quality === 'low' // cheaper textures/geometry
    this.movementSpeed = SPEED * (this.mobile ? 0.75 : 1)
    this.over = false
    this.disposed = false
    this.keys = {}
    this.shells = []
    this.bullets = []
    this.mgFx = []
    this.explosions = []
    this.flashes = []
    this.muzzleFx = []
    this.pickups = []
    this.hitArcs = []
    this.trees = []
    this.fallingTrees = []
    this.rocks = []
    this.smokes = []
    this.wrecks = []
    this.cars = []
    this.buildings = []
    this.roadGeos = []
    this.wreckProtos = {}
    this.fireSpots = []
    this.drops = []
    this.dropTimer = 8
    // map theme: chosen on the select screen or random each match
    const THEMES = ['forest', 'city', 'snow']
    this.theme = THEMES.includes(map) ? map : THEMES[(Math.random() * THEMES.length) | 0]
    waterFrozen = this.theme === 'snow' // frozen water is drivable on the snow map
    cityFlat = this.theme === 'city'
    this.ai = AI_LEVELS[this.theme]
    this.stats = { shots: 0, hits: 0, start: performance.now() }
  }

  start() {
    const w = this.mount.clientWidth, h = this.mount.clientHeight
    const q = this.quality
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low' })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1))
    this.renderer.shadowMap.enabled = q !== 'low'
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.mount.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xb5d6db)
    this.scene.fog = new THREE.Fog(this.theme === 'snow' ? 0xc9d5de : 0xb5d6db, 320, 1200)
    this.environmentMaterials = new EnvironmentMaterials(this.renderer, this.scene, this.lite)

    this.camera = new THREE.PerspectiveCamera(56, w / h, 0.1, 2200)
    this.cameraInitialized = false
    this.cameraLookTarget = new THREE.Vector3()
    this.cameraRecoil = 0

    this.sun = new THREE.DirectionalLight(0xffe1a0, 2.6)
    this.sun.castShadow = q !== 'low'
    const shadowSize = this.mobile || q === 'medium' ? 1024 : 2048
    this.sun.shadow.mapSize.set(shadowSize, shadowSize)
    this.sun.shadow.normalBias = 0.08
    this.sun.shadow.camera.left = -140; this.sun.shadow.camera.right = 140
    this.sun.shadow.camera.top = 140; this.sun.shadow.camera.bottom = -140
    this.sun.shadow.camera.far = 500
    this.scene.add(this.sun, this.sun.target, new THREE.AmbientLight(0xabc1d5, 0.2))
    const hemi = new THREE.HemisphereLight(this.theme === 'snow' ? 0xcfdceb : 0xb9dff4, this.theme === 'snow' ? 0xa8b4c0 : 0x998352, 0.65)
    this.scene.add(hemi)

    CRATERS.length = 0 // before any mesh samples heightAt(), or last match's craters get baked in
    this.buildTerrain()
    this.buildTrees()
    if (this.theme === 'snow') { this.buildSnowfall(); this.buildCabins() }
    this.buildCover()
    this.buildLandmarks()
    this.buildMinimapImage()
    this.buildTrackMarks()
    this.buildCraters()
    this.sfx = new SoundFX({ master: this.settings.master / 100, effects: this.settings.effects / 100, music: this.settings.music / 100 })

    // ---- player ----
    this.player = {
      mesh: new THREE.Group(), // empty until the M48A5 model lands — no placeholder tank
      yaw: Math.PI, hullYaw: Math.PI, pitch: 0, targetYaw: Math.PI, targetPitch: 0,
      hp: MAX_HP, speed: 0, vel: 0, gear: 1, shiftT: 0, cooldown: 0, radius: 4.2,
      camDist: this.mobile ? 15 : 13, dispersion: 0.15, zoom: false, moving: false,
    }
    // random spawns each new game: player on one side, enemies on the opposite side
    // (revivePlayer() restores the death position instead, so continues are unaffected)
    const spawnAng = Math.random() * Math.PI * 2
    const [px, pz] = this.findSpawn(Math.sin(spawnAng) * 400, Math.cos(spawnAng) * 400, [0, 420])
    this.player.mesh.position.set(px, groundY(px, pz), pz)
    const faceYaw = Math.atan2(-px, -pz) // toward the map centre / enemy side
    Object.assign(this.player, { yaw: faceYaw, hullYaw: faceYaw, targetYaw: faceYaw })
    this.scene.add(this.player.mesh)

    // ---- enemies ----
    this.enemies = []
    const roles = ['hunter', 'flankL', 'flankR']
    const fallback = [[-280, -380], [0, -440], [280, -380]]
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Group() // empty until the M48A5 model lands
      const a = spawnAng + Math.PI + (i - 1) * 0.55
      const r = i === 1 ? 440 : 400
      const [ex, ez] = this.findSpawn(Math.sin(a) * r, Math.cos(a) * r, fallback[i])
      mesh.position.set(ex, groundY(ex, ez), ez)
      this.scene.add(mesh)
      this.enemies.push({
        mesh, role: roles[i], hp: MAX_HP,
        speed: this.movementSpeed * this.ai.speed * (0.92 + i * 0.05), cooldown: 2 + i * 1.2, strafe: Math.random() > 0.5 ? 1 : -1,
        strafeT: 0, alive: true, radius: 4.8,
      })
    }

    // clear rocks around every spawn point so no tank starts stuck
    const spawnsAll = [this.player.mesh.position, ...this.enemies.map((e) => e.mesh.position)]
    this.rocks = this.rocks.filter((rk) =>
      spawnsAll.every((sp) => Math.hypot(sp.x - rk.x, sp.z - rk.z) > rk.r + 12))

    // initial supply drops
    for (let i = 0; i < 3; i++) this.spawnDrop()
    this.initDrones(spawnAng + Math.PI)

    this.kills = 0
    this.emitHud()
    this.player.mesh.rotation.order = 'YXZ'

    // ---- input ----
    // hold Space = coaxial MG (desktop, or a tablet/phone with a keyboard);
    // swallow it so a focused on-screen button (AIM / MAP) isn't activated
    const spaceOnly = (e) => {
      if (e.code !== 'Space' || this.paused || this.over) return // dialogs keep Space for their buttons
      e.preventDefault()
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur()
    }
    this._kd = (e) => {
      this.keys[e.code] = true; spaceOnly(e)
      if (e.code === 'KeyR' && !e.repeat) this.resetTurret()
    }
    this._ku = (e) => { this.keys[e.code] = false; spaceOnly(e) }
    this._mm = (e) => {
      // no lock yet (browser refused, or still cooling down after ESC): aim with
      // the free cursor while it is over the canvas instead of freezing the turret
      if (document.pointerLockElement !== this.renderer.domElement && (this.mobile || e.target !== this.renderer.domElement)) return
      const lim = 120 // Chrome on Windows sometimes reports one huge jump when the lock engages
      this.aimTurret(THREE.MathUtils.clamp(e.movementX, -lim, lim), THREE.MathUtils.clamp(e.movementY, -lim, lim))
    }
    this._md = (e) => {
      if (this.paused || this.over) return
      if (e.target !== this.renderer.domElement && !e.target.closest?.('.touch-aim, .touch-stick, .touch-fire, .touch-zoom')) return
      // first gesture: create audio + start BGM (browser requires a gesture)
      this.ensureAudio() // fallback to synth riff
      if (e.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches) return
      if (this.paused || this.over) return   // pause menu / end screens own the mouse
      if (document.pointerLockElement !== this.renderer.domElement) {
        // only re-lock when the canvas itself is clicked — not UI (e.g. quit dialog);
        // the same click still fires / scopes so no shot is lost to re-locking
        if (e.target === this.renderer.domElement) {
          this.renderer.domElement.requestPointerLock()?.catch?.(() => {})
        } else if (!(e.button === 0 && this.player.zoom)) return
        if (e.button === 0) this.firePlayer()
        if (e.button === 2) this.player.zoom = true
        return
      }
      if (e.button === 0) this.firePlayer()
      if (e.button === 2) this.player.zoom = true   // hold RMB = sniper zoom
    }
    // a 2nd button pressed while one is held (LMB while RMB-scoped) fires no
    // pointerdown — browsers report the chord as pointermove with button set
    this._pm = (e) => { if (e.pointerType === 'mouse' && e.button >= 0) this._md(e) }
    this._mu = (e) => { if (e.button === 2) this.player.zoom = false }
    this._cm = (e) => e.preventDefault()
    this._wh = (e) => {   // wheel zooms third-person distance (WoT-style)
      this.player.camDist = THREE.MathUtils.clamp(this.player.camDist + e.deltaY * 0.02, 7, 32)
    }
    window.addEventListener('keydown', this._kd)
    window.addEventListener('keyup', this._ku)
    window.addEventListener('mousemove', this._mm)
    window.addEventListener('pointerdown', this._md)
    window.addEventListener('pointermove', this._pm)
    window.addEventListener('mouseup', this._mu)
    window.addEventListener('contextmenu', this._cm)
    window.addEventListener('wheel', this._wh)

    this._resize = () => {
      const w2 = this.mount.clientWidth, h2 = this.mount.clientHeight
      this.camera.aspect = w2 / h2
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w2, h2)
    }
    window.addEventListener('resize', this._resize)

    this.clock = new THREE.Clock()
    this.raf = null
    this.loop = this.loop.bind(this)
    this.loop()
    this.loadModels()
  }

  // swap placeholder tanks/props for real GLB models once loaded
  loadModels() {
    const loader = new GLTFLoader()
    // keep placeholder tanks hidden until the real model lands — if the load
    // fails, fall back to showing the procedural tanks again
    const tanks = [this.player, ...this.enemies]
    for (const t of tanks) t.mesh.visible = false
    const fail = () => { for (const t of tanks) t.mesh.visible = true }
    const load = (file, cb) => {
      loader.load(`${import.meta.env.BASE_URL}models/${file}`, cb, undefined, fail)
    }
    load('m48a5.glb', (g) => {
      if (this.disposed || this.playerDying) return
      this.swapModel(this.player, prepTankModel(g.scene, this.theme === 'snow' ? new THREE.Color(0.82, 0.86, 0.92) : new THREE.Color(1, 1, 1), PLAYER_TANK_LEN))
    })
    // enemies use the same M48A5 model in a darker desert tint
    load('m48a5.glb', (g) => {
      if (this.disposed) return
      for (const e of this.enemies) {
        if (!e.alive) continue
        this.swapModel(e, prepTankModel(g.scene, this.theme === 'snow' ? new THREE.Color(0.5, 0.56, 0.64) : new THREE.Color(0.72, 0.64, 0.45), 16))
      }
    })
    // FPV kamikaze drone: keep the procedural placeholder if this fails
    loader.load(`${import.meta.env.BASE_URL}models/drone.glb`, (g) => {
      if (this.disposed) return
      this.droneProto = this.prepDroneModel(g.scene)
      for (const d of this.drones || []) this.swapDroneModel(d.mesh)
    })
    load('police-wrecks.glb', (g) => {
      if (this.disposed) return
      this.wreckProtos.police = g.scene
      this.applyCarModels()
    })
    load('barricade.glb', (g) => {
      if (this.disposed) return
      this.wreckProtos.barricade = g.scene
      this.applyCarModels()
    })
  }

  // scale+center a prop model (wreck, outpost piece) so its base sits at y=0
  prepPropModel(proto, targetLen) {
    // wrap the clone: a sub-node of a GLB keeps its own offset (police cars sit
    // ~90-320 units from origin), which centering below would otherwise double
    const inner = new THREE.Group().add(proto.clone(true))
    inner.updateMatrixWorld(true)
    const bb = new THREE.Box3().setFromObject(inner)
    const size = bb.getSize(new THREE.Vector3())
    const s = targetLen / Math.max(size.x, size.z)
    inner.scale.setScalar(s)
    inner.updateMatrixWorld(true)
    const bb2 = new THREE.Box3().setFromObject(inner)
    const ctr = bb2.getCenter(new THREE.Vector3())
    inner.position.set(-ctr.x, -bb2.min.y, -ctr.z)
    inner.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true } })
    const wrap = new THREE.Group()
    wrap.add(inner)
    return wrap
  }

  // police cars are 2 separate wrecks in one file — split by top-level node
  splitCarProtos(scene) {
    const root = scene.getObjectByName('RootNode') || scene
    const kids = root.children.filter((c) => { let has = false; c.traverse((o) => { if (o.isMesh) has = true }); return has })
    return kids.length >= 2 ? kids : [scene]
  }

  applyCarModels() {
    if (!this.wreckProtos.police && !this.wreckProtos.barricade) return
    if (this.wreckProtos.police && !this.policeVariants) this.policeVariants = this.splitCarProtos(this.wreckProtos.police)
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      if (c.glb || !c.alive) continue
      const useBarricade = i % 6 === 0 && this.wreckProtos.barricade
      const proto = useBarricade ? this.wreckProtos.barricade : this.policeVariants?.[i % this.policeVariants.length]
      if (!proto) continue
      const nu = this.prepPropModel(proto, WRECK_GLB_LEN)
      nu.position.copy(c.mesh.position)
      nu.rotation.copy(c.mesh.rotation)
      this.scene.remove(c.mesh)
      this.scene.add(nu)
      c.mesh = nu
      c.glb = true
    }
  }

  swapModel(tank, nu) {
    nu.position.copy(tank.mesh.position)
    nu.rotation.copy(tank.mesh.rotation)
    this.scene.remove(tank.mesh)
    this.scene.add(nu)
    tank.mesh = nu
    // measure the real track spacing from the loaded hull so ground marks sit
    // exactly under the wheels (hull half-width → track centres ≈ 0.82×)
    nu.updateMatrixWorld(true)
    const hb = new THREE.Box3().setFromObject(nu.getObjectByName('hull') || nu)
    hb.applyMatrix4(nu.matrixWorld.clone().invert())
    tank.trackOff = Math.max(1.2, (hb.max.x - hb.min.x) / 2 * 0.62)
    tank.trackCX = (hb.max.x + hb.min.x) / 2 // hull centre offset inside the wrap
  }

  // one-time per tank: measure the visual barrel's yaw inside the mesh frame
  // (farthest gun vertex from the turret ring) and yaw the turret contents so
  // the barrel truly faces the aim direction — handles models whose turret is
  // bound at a non-zero angle
  alignGun(tank) {
    const ud = tank.mesh.userData
    if (ud._gunAligned || !ud.turret || !ud.gun) return
    const turNode = ud.turret.children[0]
    if (!turNode) return
    ud._gunAligned = true
    // the m48a5's turret is bound yawed -90° — yaw the contents back so the
    // barrel tracks the aim direction (verified visually)
    const fix = new THREE.Group()
    ud.turret.add(fix)
    fix.attach(turNode)
    fix.rotation.y = Math.PI / 2
  }

  // traverse = base pivot tilt (x/z) + yaw. Rebuild the whole Euler every frame:
  // copying a saved quaternion back (respawn) re-decomposes it, and past ±90° of
  // yaw three.js returns the equivalent (x+π, π-y, z+π) form — setting only
  // .y on that flipped Euler swung the barrel round toward the engine deck
  setTurretYaw(mesh, yaw) {
    const tur = mesh.userData.turret, base = mesh.userData.turretBase
    if (!tur) return
    if (base) tur.rotation.set(base.x, yaw, base.z, base.order)
    else tur.rotation.y = yaw
  }

  buildTerrain() {
    const seg = 320
    const geo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const blends = new Float32Array(pos.count * 2)
    const uv = geo.attributes.uv
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const h = heightAt(x, z)
      pos.setY(i, h)
      uv.setXY(i, uv.getX(i) * 135, uv.getY(i) * 135)
      // dirt roads
      const dr = distToRoad(x, z)
      const road = h > WATER_LEVEL + 0.6 && h <= 26 ? 1 - THREE.MathUtils.smoothstep(dr, 4, 13) : 0
      const shore = 1 - THREE.MathUtils.smoothstep(h, WATER_LEVEL + 0.3, WATER_LEVEL + 2.5)
      blends[i * 2] = cityFlat ? 1 : Math.max(road, shore) // city: bare dirt/rubble, no grass
      blends[i * 2 + 1] = THREE.MathUtils.smoothstep(h, 22, 34)
    }
    geo.computeVertexNormals()
    for (let i = 0; i < pos.count; i++) {
      const slope = 1 - THREE.MathUtils.smoothstep(geo.attributes.normal.getY(i), 0.8, 0.97)
      blends[i * 2 + 1] = Math.max(blends[i * 2 + 1], slope)
    }
    geo.setAttribute('terrainBlend', new THREE.BufferAttribute(blends, 2))
    const mat = this.theme === 'snow' ? this.snowGround() : this.environmentMaterials.ground()
    const ground = new THREE.Mesh(geo, mat)
    this.groundGeo = geo
    ground.receiveShadow = true
    this.scene.add(ground)

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_HALF * 8, WORLD_HALF * 8),
      this.theme === 'snow' ? this.iceWater() : this.environmentMaterials.water()
    )
    water.rotation.x = -Math.PI / 2
    water.position.y = WATER_LEVEL
    if (this.theme === 'city') water.visible = false // city map has no water
    this.scene.add(water)

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f35 })
    for (const [x, z, w, d] of [
      [0, -WORLD_HALF, WORLD_HALF * 2 + 8, 4], [0, WORLD_HALF, WORLD_HALF * 2 + 8, 4],
      [-WORLD_HALF, 0, 4, WORLD_HALF * 2 + 8], [WORLD_HALF, 0, 4, WORLD_HALF * 2 + 8],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 14, d), wallMat)
      wall.position.set(x, -25, z)
      this.scene.add(wall)
    }
  }

  buildTrees() {
    const trunk = new THREE.CylinderGeometry(0.22, 0.45, 8, 9, 8).translate(0, 2.3, 0)
    const vertices = trunk.attributes.position
    for (let i = 0; i < vertices.count; i++) vertices.setX(i, vertices.getX(i) + ((vertices.getY(i) + 1.7) / 8) ** 2 * 0.5)
    trunk.computeVertexNormals()
    // layered pine: three stacked cones merged into one foliage geometry
    const snow = this.theme === 'snow', forest = this.theme === 'forest'
    const leaf = snow ? pineGeometry() : oakGeometry() // oaks on forest & city, pines on snow
    const trunkMat = this.environmentMaterials.bark()
    const leafMat = snow ? new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.9, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: 0x3a5a34, roughness: 0.95, side: THREE.DoubleSide })
    const N = this.theme === 'city' ? 0 : snow ? 320 : 620 // no trees in the city
    const trunks = new THREE.InstancedMesh(trunk, trunkMat, Math.max(1, N))
    const leaves = new THREE.InstancedMesh(leaf, leafMat, Math.max(1, N))
    const m = new THREE.Matrix4()
    const col = new THREE.Color()
    let placed = 0, tries = 0
    while (placed < N && tries++ < N * 20) {
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 15)
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 15)
      const h = heightAt(x, z)
      if (h < WATER_LEVEL + 1 || h > 30 || distToRoad(x, z) < 12) continue
      const s = 0.9 + Math.random() * 0.8
      m.makeScale(s, s, s).setPosition(x, h + 1.7 * s, z)
      trunks.setMatrixAt(placed, m)
      m.makeScale(s, s, s).setPosition(x, h + 3.2 * s, z)
      leaves.setMatrixAt(placed, m)
      // per-tree tint: deep pine to yellow-green
      col.setHSL(snow ? 0.55 + Math.random() * 0.05 : forest ? 0.27 + Math.random() * 0.06 : 0.24 + Math.random() * 0.06, snow ? 0.05 : 0.12 + Math.random() * 0.12, snow ? 0.78 + Math.random() * 0.12 : forest ? 0.5 + Math.random() * 0.18 : 0.65 + Math.random() * 0.18)
      leaves.setColorAt(placed, col)
      this.trees.push({ x, z, s, h, alive: true })
      placed++
    }
    trunks.count = leaves.count = placed
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    this.trunksMesh = trunks
    this.leavesMesh = leaves
    this.treeMeshes = { trunk: [trunks], leaf: [leaves] }
    trunks.userData.v = 0
    leaves.userData.v = 0
    trunks.castShadow = leaves.castShadow = true
    this.scene.add(trunks, leaves)
  }

  // WoT-map style cover: ruined village, rock outcrops, bushes
  buildCover() {
    // --- ruined village near map center ---
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8577, roughness: 0.95 })
    const brick = new THREE.MeshStandardMaterial({ color: 0x74513f, roughness: 0.9 })
    const roof = new THREE.MeshStandardMaterial({ color: 0x4a3d30, roughness: 0.9 })
    const village = this.theme === 'city' ? [] : [[-14, 20, 0.3], [10, -8, -0.2], [34, 26, 0.9], [-38, -24, 1.8], [-6, 52, -0.7], [46, -30, 0.4]]
    for (const [vx, vz, rot] of village) {
      const baseY = heightAt(vx, vz)
      if (baseY < WATER_LEVEL + 0.8) continue
      const ruin = new THREE.Group()
      // broken perimeter walls
      const wallDefs = [
        [0, 4, 0, 14, 3.5, 1], [6.5, 4, 6.5, 1, 2.5, 12], [-6.5, 3, -6, 1, 4.5, 9],
        [-2, 2.4, -6.5, 8, 2.4, 1], [4, 1.6, -6.5, 5, 1.6, 1],
      ]
      for (const [ox, oy, oz, w, h, d] of wallDefs) {
        const wmat = Math.random() > 0.5 ? concrete : brick
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wmat)
        wall.position.set(ox, oy, oz)
        wall.castShadow = wall.receiveShadow = true
        ruin.add(wall)
      }
      // collapsed slab
      const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 8), roof)
      slab.position.set(1, 0.6, 0); slab.rotation.set(0.15, 0.3, 0.08)
      slab.castShadow = true
      ruin.add(slab)
      // rubble
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(1 + Math.random() * 2, 0.8, 1 + Math.random() * 2), concrete)
        r.position.set((Math.random() - 0.5) * 16, 0.4, (Math.random() - 0.5) * 16)
        r.rotation.y = Math.random() * 3
        ruin.add(r)
      }
      ruin.position.set(vx, baseY - 0.2, vz)
      ruin.rotation.y = rot
      this.scene.add(ruin)
    }

    // city: only buildings, streets and wrecked cars — no rocks or bushes
    if (this.theme === 'city') {
      this.buildCity()
      this.buildCars()
      return
    }

    // --- rock outcrops ---
    const rockGeo = new THREE.IcosahedronGeometry(1, this.lite ? 1 : 2)
    const vertices = rockGeo.attributes.position
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i)
      const irregularity = 1 + Math.sin(x * 5 + y * 3) * Math.cos(z * 4 - x * 2) * 0.15
      vertices.setXYZ(i, x * irregularity, y * irregularity, z * irregularity)
    }
    rockGeo.computeVertexNormals()
    const rockMat = this.environmentMaterials.rock()
    const NR = 320
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, NR)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const eul = new THREE.Euler()
    let placed = 0, tries = 0
    while (placed < NR && tries++ < NR * 20) {
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 15)
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 15)
      const h = heightAt(x, z)
      if (h < WATER_LEVEL + 0.6) continue
      const s = 1.5 + Math.random() * (h > 18 ? 6 : 3)
      eul.set(Math.random(), Math.random() * 6, Math.random())
      q.setFromEuler(eul)
      m.compose(new THREE.Vector3(x, h + s * 0.3, z), q, new THREE.Vector3(s, s * 0.75, s))
      rocks.setMatrixAt(placed++, m)
      this.rocks.push({ x, z, y: h, r: s * 0.9 })
    }
    rocks.count = placed
    rocks.castShadow = rocks.receiveShadow = true
    this.scene.add(rocks)

    // --- bushes ---
    const bushGeo = mergeGeometries([
      new THREE.PlaneGeometry(3, 2).translate(0, 0.6, 0),
      new THREE.PlaneGeometry(3, 2).rotateY(Math.PI / 3).translate(0, 0.6, 0),
      new THREE.PlaneGeometry(3, 2).rotateY(Math.PI * 2 / 3).translate(0, 0.6, 0),
    ])
    const bushMat = this.environmentMaterials.grass()
    const NB = this.lite ? (this.theme === 'forest' ? 3600 : 1800) : (this.theme === 'forest' ? 6000 : 3200)
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, NB)
    placed = 0; tries = 0
    while (placed < NB && tries++ < NB * 20) {
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 10)
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 10)
      const h = heightAt(x, z)
      if (h < WATER_LEVEL + 0.6 || h > 26) continue
      const s = 0.8 + Math.random() * 1.6
      m.makeScale(s, s * 0.6, s).setPosition(x, h + s * 0.25, z)
      bushes.setMatrixAt(placed++, m)
    }
    bushes.count = placed
    bushes.castShadow = true
    this.scene.add(bushes)

    this.buildCars() // wreck cars on every map
  }

  // ruined city: a proper block grid with streets — buildings line each
  // block's edges leaving the roads clear, asphalt strips, one open plaza
  buildCity() {
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    const loadTex = (file) => {
      const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/${file}`)
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = aniso
      return t
    }
    // facade textures: Poly Haven (CC0) — cracked_concrete_wall, concrete_wall_006, brick_4, dark_brick_wall
    // tile = world units covered by one texture repeat
    const mats = [
      { file: 'bld_concrete_cracked.jpg', color: 0x9a958c, tile: 9, roughness: 0.95 },
      { file: 'bld_concrete.jpg', color: 0xd0cabe, tile: 9, roughness: 0.95 },
      { file: 'bld_brick.jpg', color: 0xa8968c, tile: 4, roughness: 0.9 },
      { file: 'bld_brick_dark.jpg', color: 0xc4b4a4, tile: 4, roughness: 0.9 },
    ].map(({ file, color, tile, roughness }) => {
      const m = new THREE.MeshStandardMaterial({ map: loadTex(file), color, roughness })
      m.userData.tile = tile
      return m
    })
    // box UVs in world units so the texture keeps its scale on any building size
    const boxUV = (geo, tile) => {
      const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
        const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i))
        if (ax > 0.5) uv.setXY(i, z / tile, y / tile)
        else if (ay > 0.5) uv.setXY(i, x / tile, z / tile)
        else uv.setXY(i, x / tile, y / tile)
      }
      return geo
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1 })
    const winMat = new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 0.9 })
    // wide streets (30 m) so tanks can manoeuvre freely; the grid covers the whole playable area
    const PITCH = 96, ROAD = 15, LINES = 5, BLOCK = PITCH - ROAD * 2 - 4
    this.cityGrid = { PITCH, ROAD, LINES }

    // cracked paving texture for street strips, tinted dark; one tile per ROAD_TILE units
    const ROAD_TILE = 10
    const roadTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/street.jpeg`)
    roadTex.colorSpace = THREE.SRGBColorSpace
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping
    roadTex.anisotropy = aniso
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, color: 0x5a5650, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })

    // street strips along the grid lines — each picks up its own terrain height
    const roads = []
    const span = PITCH * LINES * 2 + ROAD * 2
    for (let g = -LINES; g <= LINES; g++) {
      roads.push({ x: g * PITCH, z: 0, w: ROAD * 2, d: span })
      roads.push({ x: 0, z: g * PITCH, w: span, d: ROAD * 2 })
    }
    for (const r of roads) {
      if (heightAt(r.x, r.z) < WATER_LEVEL + 0.5) continue
      // subdivided + draped over the terrain: a flat strip hides tanks driving through dips
      const geo = new THREE.PlaneGeometry(r.w, r.d, Math.ceil(r.w / 3), Math.ceil(r.d / 3)).rotateX(-Math.PI / 2)
      geo.translate(r.x, 0, r.z)
      // world-space UVs: crossing strips line up and tiles keep their size on every strip
      const pos = geo.attributes.position, uv = geo.attributes.uv
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / ROAD_TILE, -pos.getZ(i) / ROAD_TILE)
      this.drapeRoad(geo)
      geo.computeVertexNormals()
      this.roadGeos.push(geo)
      const strip = new THREE.Mesh(geo, roadMat)
      strip.receiveShadow = true
      this.scene.add(strip)
    }

    // one building: body + jagged cap + window strips (no loose rubble — the city has no rocks).
    // geometry is collected per material and merged after the grid is built: one mesh per
    // building part meant ~4800 draw calls a frame, which dropped the frame rate in the city
    const bodyGeos = mats.map(() => []), capGeos = [], winGeos = []
    const place = new THREE.Object3D()
    const mkBuilding = (x, z, w, d, h, ruined) => {
      const mi = (Math.random() * mats.length) | 0
      const y = heightAt(x, z)
      bodyGeos[mi].push(boxUV(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), mats[mi].userData.tile).translate(x, y - 0.3, z))
      place.position.set(w * 0.08, h + (ruined ? -0.5 : 0.4), -d * 0.07)
      place.rotation.set(0.1 + Math.random() * (ruined ? 0.35 : 0.08), Math.random() * 0.4, 0.09 + Math.random() * (ruined ? 0.35 : 0.08))
      place.updateMatrix()
      capGeos.push(new THREE.BoxGeometry(w * 0.72, ruined ? 3 : 1.6, d * 0.72).applyMatrix4(place.matrix).translate(x, y - 0.3, z))
      const rows = Math.max(1, Math.floor(h / 3.5))
      for (let r = 0; r < rows; r++) {
        for (const side of [-1, 1]) {
          winGeos.push(new THREE.BoxGeometry(0.3, 1.6, d * 0.8).translate(x + side * (w / 2), y - 0.3 + 3 + r * 3.4, z))
        }
      }
      this.buildings.push({ x, z, w, d, y: y - 0.3, h })
      // bld: shells use the exact box (hitBuildingWall); tanks still collide with this circle
      this.rocks.push({ x, z, y, r: Math.max(w, d) * 0.62, bld: true })
      if (Math.random() < 0.35) {
        this.fireSpots.push({ x: x + (Math.random() - 0.5) * w, y: y + h * (0.5 + Math.random() * 0.5), z: z + (Math.random() - 0.5) * d, t: 0, dur: 9999 })
      }
    }

    // block grid: buildings line the perimeter so streets stay clear —
    // the centre block is an open plaza, a few lots are left empty
    for (let gx = -LINES; gx < LINES; gx++) {
      for (let gz = -LINES; gz < LINES; gz++) {
        if (gx === 0 && gz === 0) continue // open plaza at the crossroads
        if (Math.random() < 0.12) continue // occasional empty lot
        const bx = (gx + 0.5) * PITCH, bz = (gz + 0.5) * PITCH
        const along = 3 + (Math.random() < 0.5 ? 1 : 0)
        for (const side of [-1, 1]) {
          for (let i = 0; i < along; i++) {
            const w = 10 + Math.random() * 8, d = 10 + Math.random() * 6
            const off = -BLOCK / 2 + (i + 0.5) * (BLOCK / along) + (Math.random() - 0.5) * 6
            const x = bx + off, z = bz + side * (BLOCK / 2 - d / 2 - 1.5)
            if (heightAt(x, z) < WATER_LEVEL + 0.8) continue
            const ruined = Math.random() < 0.55
            mkBuilding(x, z, w, d, ruined ? 5 + Math.random() * 6 : 9 + Math.random() * 14, ruined)
          }
        }
      }
    }    const addMerged = (geos, mat, shadows) => {
      if (!geos.length) return
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat)
      for (const g of geos) g.dispose()
      mesh.castShadow = mesh.receiveShadow = shadows
      this.scene.add(mesh)
    }
    bodyGeos.forEach((geos, i) => addMerged(geos, mats[i], true))
    addMerged(capGeos, dark, false)
    addMerged(winGeos, winMat, false)
  }

  buildLandmarks() {
    if (this.theme === 'city') return // outposts belong to the open maps
    for (const [x, z] of [[42, 340], [-65, -310], [220, 80]]) {
      const h = heightAt(x, z)
      if (h < WATER_LEVEL + 1) continue
      const outpost = buildCoastalOutpost()
      outpost.position.set(x, h, z)
      this.scene.add(outpost)
      this.rocks.push({ x, z, y: h, r: 13 })
      this.buildings.push({ x, z, w: 24, d: 13 })
      const car = this.buildCar()
      car.position.set(x + 18, heightAt(x + 18, z + 10), z + 10)
      car.rotation.y = 0.3
      this.scene.add(car)
      this.cars.push({ mesh: car, x: x + 18, z: z + 10, alive: true })
    }
  }

  buildCar() {
    const g = new THREE.Group()
    const cols = [0x7a2c1e, 0x2c4a6b, 0x4a4a42, 0x6b5a2c, 0x3a3a3a]
    const mat = new THREE.MeshStandardMaterial({ color: cols[(Math.random() * cols.length) | 0], roughness: 0.7, metalness: 0.3 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x151310, roughness: 0.9 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 4.4), mat)
    body.position.y = 0.8; body.castShadow = true
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.2), mat)
    cab.position.set(0, 1.5, -0.2); cab.castShadow = true
    g.add(body, cab)
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10).rotateZ(Math.PI / 2), dark)
      w.position.set(wx, 0.38, wz)
      g.add(w)
    }
    g.scale.setScalar(CAR_SCALE)
    return g
  }

  // wrecked cars scattered along the roads — destructible like trees
  buildCars() {
    let placed = 0, tries = 0
    const grid = this.cityGrid
    while (placed < (grid ? 44 : 34) && tries++ < 400) {
      let x, z
      if (grid) {
        // abandoned along the city streets, kept off the centre line
        const line = (((Math.random() * (grid.LINES * 2 + 1)) | 0) - grid.LINES) * grid.PITCH
        const along = (Math.random() * 2 - 1) * grid.PITCH * grid.LINES
        const side = (Math.random() < 0.5 ? -1 : 1) * grid.ROAD * (0.35 + Math.random() * 0.4)
        if (Math.random() < 0.5) { x = line + side; z = along } else { x = along; z = line + side }
      } else {
        const rd = ROADS[(Math.random() * ROADS.length) | 0]
        const seg = (Math.random() * (rd.length - 1)) | 0
        const t = Math.random()
        x = rd[seg][0] + (rd[seg + 1][0] - rd[seg][0]) * t + (Math.random() - 0.5) * 14
        z = rd[seg][1] + (rd[seg + 1][1] - rd[seg][1]) * t + (Math.random() - 0.5) * 14
      }
      const h = heightAt(x, z)
      if (h < WATER_LEVEL + 0.6 || Math.abs(x) > WORLD_HALF - 20 || Math.abs(z) > WORLD_HALF - 20) continue
      const mesh = this.buildCar()
      mesh.position.set(x, h, z)
      mesh.rotation.y = Math.random() * Math.PI * 2
      mesh.rotation.z = (Math.random() - 0.5) * 0.15
      this.scene.add(mesh)
      this.cars.push({ mesh, x, z, alive: true })
      placed++
    }
  }

  destroyCar(c) {
    if (!c.alive) return
    c.alive = false
    this.sfx?.explode()
    this.explode(c.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)))
    this.addCrater(c.x, c.z, 3.5 * CAR_SCALE, 0.5)
    this.scene.remove(c.mesh)
    // wreck burns for a while
    this.fireSpots.push({ x: c.x, y: heightAt(c.x, c.z) + CAR_SCALE, z: c.z, t: 0, dur: 14 })
  }

  buildTrackMarks() {
    const cv = document.createElement('canvas')
    cv.width = 64; cv.height = 64
    const ctx = cv.getContext('2d')
    ctx.fillStyle = this.theme === 'snow' ? '#c9d8e6' : '#251c13'
    ctx.globalAlpha = 0.25
    ctx.fillRect(4, 0, 56, 64)
    ctx.globalAlpha = 0.85
    for (let y = 0; y < 64; y += 16) ctx.fillRect(2, y + 2, 60, 8)
    const texture = new THREE.CanvasTexture(cv)
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.trackMarks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.85, 0.8).rotateX(-Math.PI / 2), material, 2400)
    this.trackMarks.count = 0
    this.trackMarks.frustumCulled = false
    this.trackMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.trackCursor = 0
    this.trackDummy = new THREE.Object3D()
    this.trackNormal = new THREE.Vector3()
    this.trackUp = new THREE.Vector3(0, 1, 0)
    this.scene.add(this.trackMarks)
  }

  updateTrackMarks(tank) {
    const pos = tank.mesh.position, yaw = tank.hullYaw ?? tank.mesh.rotation.y
    const off = tank.trackOff ?? 2.25
    const sh = tank.trackCX ?? 0 // hull centre offset — marks sit under the hull, not the wrap origin
    const last = tank.lastTrack
    if (!last) { tank.lastTrack = { x: pos.x, z: pos.z, yaw }; return }
    const distance = Math.hypot(pos.x - last.x, pos.z - last.z)
    const turn = Math.abs(Math.atan2(Math.sin(yaw - last.yaw), Math.cos(yaw - last.yaw)))
    if (distance < 0.65 && turn < 0.16) return
    const steps = Math.min(8, Math.max(1, Math.ceil(distance / 0.65)))
    for (let step = 1; step <= steps; step++) {
      const cx = THREE.MathUtils.lerp(last.x, pos.x, step / steps)
      const cz = THREE.MathUtils.lerp(last.z, pos.z, step / steps)
      for (const side of [-1, 1]) {
        const mx = cx + Math.cos(yaw) * sh, mz = cz - Math.sin(yaw) * sh
        const x = mx + Math.cos(yaw) * side * off, z = mz - Math.sin(yaw) * side * off
        if (isWater(x, z)) continue
        this.trackNormal.set(heightAt(x - 0.5, z) - heightAt(x + 0.5, z), 1, heightAt(x, z - 0.5) - heightAt(x, z + 0.5)).normalize()
        const dummy = this.trackDummy
        dummy.position.set(x, heightAt(x, z) + 0.045, z)
        dummy.quaternion.setFromUnitVectors(this.trackUp, this.trackNormal)
        dummy.rotateY(yaw)
        dummy.updateMatrix()
        this.trackMarks.setMatrixAt(this.trackCursor, dummy.matrix)
        this.trackCursor = (this.trackCursor + 1) % 2400
        this.trackMarks.count = Math.min(2400, this.trackMarks.count + 1)
      }
    }
    this.trackMarks.instanceMatrix.needsUpdate = true
    tank.lastTrack = { x: pos.x, z: pos.z, yaw }
  }

  buildCraters() {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
    g.addColorStop(0, 'rgba(8,6,4,0.95)'); g.addColorStop(0.45, 'rgba(15,12,8,0.8)')
    g.addColorStop(0.8, 'rgba(20,16,10,0.35)'); g.addColorStop(1, 'rgba(20,16,10,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
    const texture = new THREE.CanvasTexture(cv)
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    this.craterMarks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, 64)
    this.craterMarks.count = 0
    this.craterMarks.frustumCulled = false
    this.scene.add(this.craterMarks)
    this.craterCursor = 0

    // shell impact marks on building walls: black soot blast around a dark, jagged hole
    const wc = document.createElement('canvas')
    wc.width = wc.height = 128
    const w = wc.getContext('2d')
    const soot = w.createRadialGradient(64, 64, 6, 64, 64, 63)
    soot.addColorStop(0, 'rgba(0,0,0,1)'); soot.addColorStop(0.35, 'rgba(5,4,3,0.9)')
    soot.addColorStop(0.7, 'rgba(10,8,6,0.45)'); soot.addColorStop(1, 'rgba(10,8,6,0)')
    w.fillStyle = soot; w.fillRect(0, 0, 128, 128)
    const blob = (cx, cy, r0, jitter, n = 16) => {
      w.beginPath()
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2, r = r0 * (1 - jitter / 2 + Math.random() * jitter)
        w.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      }
      w.fill()
    }
    // uneven soot splatter streaking outward
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 30
      w.fillStyle = `rgba(4,3,2,${0.25 + Math.random() * 0.4})`
      blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + Math.random() * 9, 0.6, 10)
    }
    // hole: scorched rim -> shaded wall of the cavity -> black core
    w.fillStyle = 'rgba(20,16,12,1)'; blob(64, 64, 24, 0.55)
    const cav = w.createRadialGradient(60, 60, 2, 64, 64, 18)
    cav.addColorStop(0, 'rgba(0,0,0,1)'); cav.addColorStop(0.6, 'rgba(8,6,5,1)'); cav.addColorStop(1, 'rgba(38,32,26,1)')
    w.fillStyle = cav; blob(64, 64, 17, 0.5)
    w.fillStyle = 'rgba(0,0,0,1)'; blob(63, 63, 9, 0.45)
    w.strokeStyle = 'rgba(0,0,0,0.85)'
    for (let k = 0; k < 9; k++) {
      let a = Math.random() * Math.PI * 2, r = 10, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r
      w.lineWidth = 1 + Math.random() * 1.5
      w.beginPath(); w.moveTo(x, y)
      for (let s = 0; s < 4; s++) {
        a += (Math.random() - 0.5) * 0.7; r = 9 + Math.random() * 10
        x += Math.cos(a) * r; y += Math.sin(a) * r; w.lineTo(x, y)
      }
      w.stroke()
    }
    const wallMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(wc), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    this.wallMarks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), wallMat, 120)
    this.wallMarks.count = 0
    this.wallMarks.frustumCulled = false
    this.scene.add(this.wallMarks)
    this.wallCursor = 0
    this.wallFwd = new THREE.Vector3(0, 0, 1)
    this.wallSpin = new THREE.Quaternion()
  }

  // shell hole decal on a wall at point p facing outward along normal n
  addWallMark(p, n, size) {
    const dummy = this.trackDummy
    dummy.position.copy(p).addScaledVector(n, 0.05)
    dummy.quaternion.setFromUnitVectors(this.wallFwd, n)
    dummy.quaternion.multiply(this.wallSpin.setFromAxisAngle(this.wallFwd, Math.random() * Math.PI * 2))
    dummy.scale.setScalar(size)
    dummy.updateMatrix()
    dummy.scale.setScalar(1)
    this.wallMarks.setMatrixAt(this.wallCursor, dummy.matrix)
    this.wallCursor = (this.wallCursor + 1) % 120
    this.wallMarks.count = Math.min(120, this.wallMarks.count + 1)
    this.wallMarks.instanceMatrix.needsUpdate = true
  }

  // shell segment a→b vs axis-aligned city building boxes; returns the wall hit or null
  hitBuildingWall(a, b) {
    for (const bl of this.buildings) {
      if (bl.h === undefined) continue
      // x faces carry the window strips (0.15 proud of the wall)
      const hx = bl.w / 2 + 0.15, hz = bl.d / 2, top = bl.y + bl.h
      const bx = b.x - bl.x, bz = b.z - bl.z
      if (Math.abs(bx) > hx || Math.abs(bz) > hz || b.y > top || b.y < bl.y) continue
      const ax = a.x - bl.x, az = a.z - bl.z
      // entry face = the slab the segment crossed last
      const n = new THREE.Vector3(Math.sign(bx) || 1, 0, 0)
      let t = 0
      if (Math.abs(ax) > hx) { const tx = (Math.sign(ax) * hx - ax) / (bx - ax); if (tx > t) { t = tx; n.set(Math.sign(ax), 0, 0) } }
      if (Math.abs(az) > hz) { const tz = (Math.sign(az) * hz - az) / (bz - az); if (tz > t) { t = tz; n.set(0, 0, Math.sign(az)) } }
      if (a.y > top) { const ty = (top - a.y) / (b.y - a.y); if (ty > t) { t = ty; n.set(0, 1, 0) } }
      return { p: a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1)), n }
    }
    return null
  }

  // real crater: deform terrain heightfield + scorch decal — tanks can drive into it
  addCrater(x, z, r = 4.5, depth = 0.8) {
    if (isWater(x, z)) return
    CRATERS.push({ x, z, r, depth })
    // an expired crater must leave the meshes too, or tanks hover over its ghost
    if (CRATERS.length > 48) { const old = CRATERS.shift(); this.refitGround(old.x, old.z, old.r) }
    this.refitGround(x, z, r)
    // scorch decal
    this.trackNormal.set(heightAt(x - 0.5, z) - heightAt(x + 0.5, z), 1, heightAt(x, z - 0.5) - heightAt(x, z + 0.5)).normalize()
    const dummy = this.trackDummy
    dummy.position.set(x, heightAt(x, z) + 0.06, z)
    dummy.quaternion.setFromUnitVectors(this.trackUp, this.trackNormal)
    dummy.scale.setScalar(r * 2.2)
    dummy.updateMatrix()
    dummy.scale.setScalar(1)
    this.craterMarks.setMatrixAt(this.craterCursor, dummy.matrix)
    this.craterCursor = (this.craterCursor + 1) % 64
    this.craterMarks.count = Math.min(64, this.craterMarks.count + 1)
    this.craterMarks.instanceMatrix.needsUpdate = true
  }

  // re-fit terrain + road vertices to heightAt() around a changed spot
  refitGround(x, z, r) {
    const r2 = r * r * 5
    const pos = this.groundGeo.attributes.position
    const nrm = this.groundGeo.attributes.normal
    const e = 1.6
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vz = pos.getZ(i)
      const dx = vx - x, dz = vz - z
      if (dx * dx + dz * dz > r2) continue
      pos.setY(i, heightAt(vx, vz))
      const nx = heightAt(vx - e, vz) - heightAt(vx + e, vz)
      const nz = heightAt(vx, vz - e) - heightAt(vx, vz + e)
      const l = Math.hypot(nx, 2 * e, nz)
      nrm.setXYZ(i, nx / l, 2 * e / l, nz / l)
    }
    pos.needsUpdate = true
    nrm.needsUpdate = true
    for (const geo of this.roadGeos) if (this.drapeRoad(geo, x, z, r2)) geo.computeVertexNormals()
  }

  drapeRoad(geo, x = 0, z = 0, r2 = Infinity) {
    const pos = geo.attributes.position
    let changed = false
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vz = pos.getZ(i)
      if ((vx - x) ** 2 + (vz - z) ** 2 > r2) continue
      pos.setY(i, heightAt(vx, vz) + 0.1)
      changed = true
    }
    if (changed) { pos.needsUpdate = true; geo.computeBoundingSphere() }
    return changed
  }

  // screen-space offset (px from centre) of a world point, pinned inside the
  // screen edge so the reticle stays visible while the turret is traversing
  screenOffset(point, out) {
    const ndc = point.clone().project(this.camera)
    if (ndc.z >= 1) return false
    out.x = THREE.MathUtils.clamp(ndc.x, -0.92, 0.92) * this.mount.clientWidth / 2
    out.y = -THREE.MathUtils.clamp(ndc.y, -0.92, 0.92) * this.mount.clientHeight / 2
    return true
  }

  buildMinimapImage() {
    const S = 512, scale = S / (WORLD_HALF * 2), stride = S + 2
    const cv = document.createElement('canvas')
    cv.width = cv.height = S
    const ctx = cv.getContext('2d')
    const heights = new Float32Array(stride * stride)
    for (let y = 0; y < stride; y++) for (let x = 0; x < stride; x++) {
      heights[y * stride + x] = heightAt((x - 1) / scale - WORLD_HALF, (y - 1) / scale - WORLD_HALF)
    }
    const image = ctx.createImageData(S, S)
    for (let iy = 0; iy < S; iy++) {
      for (let ix = 0; ix < S; ix++) {
        const x = ix / scale - WORLD_HALF, z = iy / scale - WORLD_HALF
        const i = (iy + 1) * stride + ix + 1, h = heights[i]
        const grain = Math.sin(x * 7.13 + z * 3.71) * Math.cos(x * 2.37 - z * 5.19) * 6
        const slope = (heights[i - 1] - heights[i + 1] + heights[i - stride] - heights[i + stride]) * 0.22
        const light = THREE.MathUtils.clamp(0.92 + slope, 0.5, 1.35)
        let color
        const grid = this.cityGrid
        if (grid) {
          const off = (v) => Math.abs(v - Math.round(v / grid.PITCH) * grid.PITCH)
          const street = Math.max(Math.abs(x), Math.abs(z)) <= grid.PITCH * grid.LINES + grid.ROAD && Math.min(off(x), off(z)) < grid.ROAD
          color = street ? [62, 60, 57] : [104, 98, 86]
        } else {
          color = h < WATER_LEVEL + 0.4 ? [39, 67, 71] : h < WATER_LEVEL + 1.5 ? [124, 114, 79] : h > 26 ? [111, 108, 94] : h > 18 ? [86, 91, 61] : [67 + h, 79 + h * 0.6, 43 + h * 0.5]
          if (distToRoad(x, z) < 9 && h > WATER_LEVEL + 0.6 && h <= 26) color = [129, 113, 81]
        }
        const pixel = (iy * S + ix) * 4
        for (let c = 0; c < 3; c++) image.data[pixel + c] = color[c] * light + grain
        image.data[pixel + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    for (const t of this.trees) {
      const x = (t.x + WORLD_HALF) * scale, y = (t.z + WORLD_HALF) * scale, r = Math.max(1.2, t.s * 3 * scale)
      ctx.fillStyle = '#0b140b80'
      ctx.beginPath(); ctx.ellipse(x + 2, y + 2, r * 1.2, r, 0.5, 0, Math.PI * 2); ctx.fill()
      const crown = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
      crown.addColorStop(0, '#60704a'); crown.addColorStop(1, '#243321')
      ctx.fillStyle = crown
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    for (const b of this.buildings) {
      const x = (b.x + WORLD_HALF - b.w / 2) * scale, y = (b.z + WORLD_HALF - b.d / 2) * scale
      ctx.fillStyle = '#080a0bc0'; ctx.fillRect(x + 3, y + 3, b.w * scale, b.d * scale)
      ctx.fillStyle = '#9a8d7b'; ctx.fillRect(x, y, b.w * scale, b.d * scale)
      ctx.strokeStyle = '#c0b39a'; ctx.lineWidth = 0.6; ctx.strokeRect(x, y, b.w * scale, b.d * scale)
    }
    ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 0.7
    ctx.beginPath()
    for (let n = 0; n <= 10; n++) {
      const p = n * S / 10
      ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.moveTo(0, p); ctx.lineTo(S, p)
    }
    ctx.stroke()
    this.minimapImage = cv
  }

  emitHud() {
    this.onHud({
      hp: this.player.hp, maxHp: MAX_HP, ammo: Infinity,
      kills: this.kills, total: this.enemies.length, theme: this.theme,
      apT: Math.ceil(this.player.apT || 0),
      hitArcs: this.hitArcs,
    })
  }

  // live volume changes from the pause menu (graphics quality still applies next battle)
  applySettings(s) {
    this.settings = { ...this.settings, ...s }
    this.sfx?.setVolumes({ master: s.master / 100, effects: s.effects / 100, music: s.music / 100 })
    if (this.bgm) this.bgm.volume = 0.4 * channelVolume(this.settings, 'music')
  }

  ensureAudio() {
    if (this.sfx.ctx.state === 'suspended') this.sfx.ctx.resume().catch(() => {})
    if (!this.bgm) {
      this.bgm = new Audio(bgUrl)
      this.bgm.loop = true
      this.bgm.volume = 0.4 * channelVolume(this.settings, 'music')
      this.bgm.play().catch(() => this.sfx.startMusic())
    }
  }

  // R / mobile reset button: swing turret + gun back to straight ahead over the hull
  resetTurret() {
    if (this.paused || this.over || this.playerDying || this.victory) return
    this.player.turretReset = true
    this.player.zoom = false
  }

  aimTurret(dx, dy, touch = false) {
    if (this.paused || this.over) return
    const p = this.player
    const sensitivity = (touch ? TOUCH_SENS : MOUSE_SENS) * (this.settings?.sensitivity ?? 100) / 100
    const ySign = this.settings?.invertY ? -1 : 1
    if (p.turretReset) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return // ignore jitter while re-centring
      p.turretReset = false                        // a real aim move takes over
    }
    p.targetYaw -= dx * sensitivity
    const delta = Math.atan2(Math.sin(p.targetYaw - p.yaw), Math.cos(p.targetYaw - p.yaw))
    // no lead cap: the view never stops mid-swing; re-basing within ±π of the turret
    // makes it traverse the short way (aim behind = turret swings round the near side)
    p.targetYaw = p.yaw + delta
    // +pitch = barrel down; mouse/finger down → aim down (Invert Y flips it)
    p.targetPitch = THREE.MathUtils.clamp(p.targetPitch + dy * sensitivity * ySign, this.droneMode ? DEF_PITCH_UP : PITCH_UP, PITCH_DOWN)
  }

  // world-space muzzle tip position: gun pivot + a barrel's length along the
  // aim direction — the visual barrel always follows the aim yaw/pitch, so the
  // reticle ray uses the same direction the gun is modeled to point
  muzzleInfo(tank, dir) {
    const gun = tank.mesh.userData.gun
    if (!gun || !dir) return null
    const pos = gun.getWorldPosition(this._gunV ??= new THREE.Vector3())
    return pos.clone().addScaledVector(dir, 11.5)
  }

  starburstTex() {
    if (this._sbTex) return this._sbTex
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0, 'rgba(255,245,210,1)')
    g.addColorStop(0.35, 'rgba(255,180,80,0.85)')
    g.addColorStop(1, 'rgba(255,110,20,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    // pointed star spikes, WoT-style muzzle flare
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'rgba(255,225,170,0.9)'
    for (const [dx, dy, len, w] of [[1, 0, 62, 8], [0, 1, 62, 8], [0.7, 0.7, 48, 5], [-0.7, 0.7, 48, 5]]) {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(64 - dx * len, 64 - dy * len)
      ctx.lineTo(64 + dx * len, 64 + dy * len)
      ctx.stroke()
    }
    this._sbTex = new THREE.CanvasTexture(cv)
    return this._sbTex
  }

  // barrel blast: starburst sprite + light kick + powder smoke rolling forward
  muzzleFlash(pos, dir) {
    const sp = new THREE.Sprite(this._sbMat ??= new THREE.SpriteMaterial({
      map: this.starburstTex(), color: 0xffe0a0, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, depthTest: false,
    }))
    sp.position.copy(pos).addScaledVector(dir, 0.5)
    sp.scale.setScalar(9 + Math.random() * 4)
    this.scene.add(sp)
    this.muzzleFx.push({ sp, t: 0 })
    if (this.flashes.length < 3) {
      const l = new THREE.PointLight(0xffc060, 200, 45)
      l.position.copy(sp.position)
      this.scene.add(l)
      this.flashes.push({ l, t: 0 })
    }
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.6 + i * 0.35, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x9a9a94, transparent: true, opacity: 0.45 })
      )
      m.position.copy(sp.position).addScaledVector(dir, i * 0.9)
      this.scene.add(m)
      this.smokes.push({ mesh: m, t: 0, o0: 0.45, vel: dir.clone().multiplyScalar(5 + i * 2).add(new THREE.Vector3(0, 2 + i, 0)) })
    }
    // hot sparks streaking out of the muzzle
    for (let i = 0; i < 8; i++) {
      const v = dir.clone().multiplyScalar(30 + Math.random() * 34)
      v.x += (Math.random() - 0.5) * 10; v.y += (Math.random() - 0.5) * 10 + 3; v.z += (Math.random() - 0.5) * 10
      const s = new THREE.Mesh(
        new THREE.PlaneGeometry(0.14, 0.9 + Math.random() * 0.8),
        new THREE.MeshBasicMaterial({ color: 0xffc44a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
      )
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize())
      s.position.copy(sp.position)
      this.scene.add(s)
      this.smokes.push({ mesh: s, t: 0, o0: 1, rate: 3.4, vel: v })
    }
  }

  firePlayer() {
    const p = this.player
    if (this.paused || this.over || this.playerDying || this.victory) return
    // a click just before the breech is ready is kept and fires the moment it is
    if (p.cooldown > 0) { if (p.cooldown <= FIRE_BUFFER) p.fireQueued = true; return }
    p.fireQueued = false
    this.ensureAudio()
    p.cooldown = RELOAD_TIME
    this.sfx?.fire()
    this.cameraRecoil = 0.65
    this.stats.shots++
    // WoT convergence: shell flies toward the point under the crosshair —
    // sniper sight sits on the camera ray; third-person reticle follows the barrel
    const from = p.mesh.position.clone().add(new THREE.Vector3(0, 3.2, 0))
    const target = (p.zoom ? this.aimPoint : this.gunAimPoint || this.aimPoint) || from.clone().addScaledVector(this.aimDir, 500)
    const dir = target.sub(from).normalize()
    // dispersion spread
    const sp = p.dispersion * 0.06
    dir.x += (Math.random() - 0.5) * sp * 2
    dir.y += (Math.random() - 0.5) * sp
    dir.z += (Math.random() - 0.5) * sp * 2
    dir.normalize()
    this.spawnShell(from.add(dir.clone().multiplyScalar(8)), dir.clone().multiplyScalar(160), 'player')
    this.muzzleFlash(this.muzzleInfo(p, dir) || from, dir)
    p.dispersion = Math.min(1, p.dispersion + 0.55) // recoil bloom
    this.emitHud()
  }

  fireEnemy(e, targetPos) {
    if (e.cooldown > 0) return
    e.cooldown = RELOAD_TIME * this.ai.reload
    this.sfx?.fire()
    const from = e.mesh.position.clone().add(new THREE.Vector3(0, 3.8, 0))
    const dir = targetPos.clone().add(new THREE.Vector3(0, 2, 0)).sub(from).normalize()
    const dist = from.distanceTo(targetPos)
    const spread = (0.015 + dist * 0.00045) * this.ai.spread
    dir.x += (Math.random() - 0.5) * spread * 2
    dir.y += (Math.random() - 0.5) * spread
    dir.z += (Math.random() - 0.5) * spread * 2
    dir.normalize()
    this.spawnShell(from.add(dir.clone().multiplyScalar(7.5)), dir.clone().multiplyScalar(120), 'enemy', e.apT > 0 ? 2 : 1)
    this.muzzleFlash(this.muzzleInfo(e, dir) || from, dir)
  }

  spawnShell(pos, vel, owner, ap = 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshBasicMaterial({ color: owner === 'player' ? 0xffe08a : 0xff5030 })
    )
    mesh.position.copy(pos)
    this.scene.add(mesh)
    this.shells.push({ mesh, vel, owner, life: 6, ap })
  }

  // coaxial MG: heat builds 1/20 per round; at full heat the gun locks for MG_COOL seconds
  updateMG(dt) {
    const p = this.player
    p.mgHeat ??= 0
    p.mgT = Math.max(0, (p.mgT || 0) - dt)
    const trigger = (this.keys.Space || this.mgTouch) && !this.paused && !this.over && !this.playerDying
    if (p.mgOver) {
      p.mgHeat = Math.max(0, p.mgHeat - dt / MG_COOL)
      if (p.mgHeat === 0) p.mgOver = false
    } else if (trigger) {
      while (p.mgT <= 0 && !p.mgOver) {
        this.fireMG()
        p.mgT += 1 / MG_RATE
        p.mgHeat = Math.min(1, p.mgHeat + 1 / MG_ROUNDS_PER_SHELL)
        if (p.mgHeat >= 1) p.mgOver = true
      }
    } else {
      p.mgHeat = Math.max(0, p.mgHeat - dt * 0.35)
    }
  }

  mgMaterial() {
    return (this._mgMat ??= new THREE.MeshBasicMaterial({ color: 0xffcf6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  }

  fireMG() {
    const p = this.player
    this.ensureAudio()
    this.sfx?.mg()
    const gun = p.mesh.userData.gun
    const from = gun ? gun.getWorldPosition(new THREE.Vector3()) : p.mesh.position.clone().add(new THREE.Vector3(0, 3.2, 0))
    const target = (p.zoom ? this.aimPoint : this.gunAimPoint || this.aimPoint)?.clone() || from.clone().addScaledVector(this.aimDir, 500)
    const dir = target.sub(from).normalize()
    const side = new THREE.Vector3().crossVectors(dir, this._up ??= new THREE.Vector3(0, 1, 0)).normalize()
    const sp = 0.008 + p.dispersion * 0.02
    dir.x += (Math.random() - 0.5) * sp * 2
    dir.y += (Math.random() - 0.5) * sp
    dir.z += (Math.random() - 0.5) * sp * 2
    dir.normalize()
    // mounted beside the main gun in the mantlet
    const muzzle = from.addScaledVector(side, 0.9).addScaledVector(dir, 4.5)
    const m = new THREE.Mesh(this._mgGeo ??= new THREE.BoxGeometry(0.14, 0.14, 3), this.mgMaterial())
    m.position.copy(muzzle)
    m.lookAt(muzzle.clone().add(dir))
    this.scene.add(m)
    this.bullets.push({ mesh: m, vel: dir.clone().multiplyScalar(MG_SPEED), life: 1.6 })
    this.mgFxBurst(muzzle, 1, 'flash')
  }

  // kind: 'spark' (hot fragments), 'dust' (puff), 'flash' (muzzle)
  mgFxBurst(pos, n, kind) {
    const geo = kind === 'dust' ? (this._mgDustGeo ??= new THREE.SphereGeometry(0.5, 6, 4))
      : kind === 'flash' ? (this._mgFlashGeo ??= new THREE.SphereGeometry(0.45, 6, 4))
      : (this._mgSparkGeo ??= new THREE.BoxGeometry(0.1, 0.1, 0.7))
    const mat = kind === 'dust' ? (this._mgDustMat ??= new THREE.MeshBasicMaterial({ color: 0x8a8070, transparent: true, opacity: 0.55, depthWrite: false })) : this.mgMaterial()
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat)
      m.position.copy(pos)
      const v = kind === 'flash' ? new THREE.Vector3()
        : new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(kind === 'dust' ? 4 : 18)
      if (kind === 'spark') m.lookAt(pos.clone().add(v))
      this.scene.add(m)
      this.mgFx.push({ mesh: m, vel: v, t: 0, kind, life: kind === 'dust' ? 0.5 : kind === 'flash' ? 0.06 : 0.18 })
    }
  }

  updateMGFx(dt) {
    for (let i = this.mgFx.length - 1; i >= 0; i--) {
      const f = this.mgFx[i]
      f.t += dt
      f.mesh.position.addScaledVector(f.vel, dt)
      if (f.kind === 'spark') f.vel.y -= 9 * dt
      else f.vel.multiplyScalar(0.9)
      const k = Math.max(0.01, 1 - f.t / f.life)
      f.mesh.scale.setScalar(f.kind === 'dust' ? (1 + f.t * 6) * k : k)
      if (f.t >= f.life) { this.scene.remove(f.mesh); this.mgFx.splice(i, 1) }
    }
  }

  updateBullets(dt) {
    const seg = (this._mgSeg ??= new THREE.Line3()), cp = (this._mgCp ??= new THREE.Vector3())
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.life -= dt
      b.vel.y -= 3 * dt
      const prev = b.mesh.position.clone()
      b.mesh.position.addScaledVector(b.vel, dt)
      const bp = b.mesh.position
      let hit = b.life <= 0 ? 'gone' : null
      if (!hit && bp.y <= heightAt(bp.x, bp.z)) { bp.y = heightAt(bp.x, bp.z) + 0.1; hit = 'ground' }
      if (!hit) {
        seg.set(prev, bp)
        for (const d of this.drones) {
          if (d.state !== 'fly') continue
          seg.closestPointToPoint(d.mesh.position, true, cp)
          if (cp.distanceTo(d.mesh.position) < 2.2) { bp.copy(cp); this.destroyDrone(d); hit = 'tank'; break }
        }
      }
      if (!hit) {
        for (const e of this.enemies) {
          if (!e.alive) continue
          const c = e.mesh.position.clone(); c.y += 2.4
          seg.closestPointToPoint(c, true, cp)
          if (cp.distanceTo(c) < e.radius + 0.4) {
            bp.copy(cp)
            this.damageEnemy(e, MG_DMG * (this.player.apT > 0 ? 2 : 1), false)
            hit = 'tank'; break
          }
        }
      }
      if (!hit && this.theme === 'city') {
        const w = this.hitBuildingWall(prev, bp)
        if (w) { bp.copy(w.p).addScaledVector(w.n, 0.2); hit = 'wall' }
      }
      if (!hit) {
        for (const c of this.cars) {
          if (!c.alive) continue
          const dx = bp.x - c.x, dz = bp.z - c.z
          if (dx * dx + dz * dz < (2.4 * CAR_SCALE) ** 2 && bp.y < heightAt(c.x, c.z) + 3 * CAR_SCALE) { hit = 'car'; break }
        }
      }
      if (!hit) {
        for (const rk of this.rocks) {
          if (rk.bld) continue
          const dx = bp.x - rk.x, dz = bp.z - rk.z
          if (dx * dx + dz * dz < rk.r * rk.r && bp.y < rk.y + rk.r) { hit = 'rock'; break }
        }
      }
      if (hit) {
        if (hit === 'tank' || hit === 'car') this.mgFxBurst(bp, 5, 'spark')
        else if (hit !== 'gone') { this.mgFxBurst(bp, 2, 'dust'); this.mgFxBurst(bp, 2, 'spark') }
        this.scene.remove(b.mesh)
        this.bullets.splice(i, 1)
      }
    }
  }

  explode(pos, big = false) {
    const groundH = heightAt(pos.x, pos.z)
    const scale = big ? 2.6 : 2
    const group = { t: 0, parts: [], debris: [] }
    // white-hot core — flashes out fast
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3c8, transparent: true, opacity: 1, depthWrite: false })
    )
    core.position.copy(pos)
    // orange fireball — blooms outward and dims
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.85, depthWrite: false })
    )
    fire.position.copy(pos)
    // ground shockwave ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 1, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    )
    this.trackNormal.set(heightAt(pos.x - 0.5, pos.z) - heightAt(pos.x + 0.5, pos.z), 1, heightAt(pos.x, pos.z - 0.5) - heightAt(pos.x, pos.z + 0.5)).normalize()
    ring.position.set(pos.x, groundH + 0.25, pos.z)
    ring.quaternion.setFromUnitVectors(this.trackUp, this.trackNormal)
    this.scene.add(core, fire, ring)
    group.parts = [core, fire, ring]
    // light flash on nearby surfaces (cap active lights)
    if (this.flashes.length < 3) {
      const l = new THREE.PointLight(0xffb050, big ? 520 : 320, 95)
      l.position.copy(pos).y += 2.5
      this.scene.add(l)
      this.flashes.push({ l, t: 0 })
    }
    // dirt + shrapnel chunks tossed up
    const n = this.mobile ? 14 : 24
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, transparent: true })
    for (let i = 0; i < n; i++) {
      const d = new THREE.Mesh(
        new THREE.BoxGeometry(0.25 + Math.random() * 0.5, 0.25 + Math.random() * 0.5, 0.25 + Math.random() * 0.5),
        debrisMat
      )
      d.position.copy(pos)
      const a = Math.random() * Math.PI * 2, up = 9 + Math.random() * 12 * scale, out = 3 + Math.random() * 8 * scale
      group.debris.push({ mesh: d, vel: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out), rot: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4), landed: false })
      this.scene.add(d)
    }
    // lingering black smoke
    for (let i = 0; i < 6; i++) this.puffSmoke(pos, true)
    group.scale = scale
    this.explosions.push(group)
  }

  damageEnemy(e, dmg, countHit = true) {
    e.hp -= dmg
    if (countHit) this.stats.hits++
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.kills++
      this.tankExplode(e.mesh)   // tank becomes a charred wreck
      this.emitHud()
      if (this.enemies.every((x) => !x.alive)) this.startVictory(e)
    }
  }

  startVictory(e) {
    if (this.victory || this.over) return
    const time = Math.round((performance.now() - this.stats.start) / 1000)
    const focus = e.mesh.position.clone().add(new THREE.Vector3(0, 2, 0))
    const back = this.camera.position.clone().sub(focus).setY(0)
    if (back.lengthSq() < 1) back.set(0, 0, -1)
    back.normalize()
    // city: pick the first bearing (nearest to the current view) with no building in the way
    const blocked = (a, b) => {
      if (this.theme !== 'city') return false
      let prev = a
      for (let i = 1; i <= 12; i++) {
        const cur = a.clone().lerp(b, i / 12)
        if (this.hitBuildingWall(prev, cur)) return true
        prev = cur
      }
      return false
    }
    const up = (this._up ??= new THREE.Vector3(0, 1, 0))
    let camPos = null
    for (let k = 0; k < 8 && !camPos; k++) {
      const d = back.clone().applyAxisAngle(up, (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4))
      const c = focus.clone().addScaledVector(d, VICTORY_DIST).add(new THREE.Vector3(0, VICTORY_HEIGHT, 0))
      c.y = Math.max(c.y, heightAt(c.x, c.z) + 3)
      if (!blocked(focus, c)) camPos = c
    }
    camPos ??= focus.clone().addScaledVector(back, 10).add(new THREE.Vector3(0, 34, 0)) // over the rooftops
    this.player.zoom = false
    this.player.mesh.visible = true
    this.keys = {}; this.touchDrive = null; this.mgTouch = false
    this.victory = { t: 0, focus, camPos, time }
  }

  updateVictory(dt) {
    const v = this.victory
    v.t += dt
    this.camera.position.lerp(v.camPos, 1 - Math.exp(-2.5 * dt))
    this.cameraLookTarget.lerp(v.focus, 1 - Math.exp(-4 * dt))
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 50, 3, dt)
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(this.cameraLookTarget)
    if (v.t >= VICTORY_HOLD) this.finish(true)
  }

  damagePlayer(dmg, fromDir) {
    if (this.over || this.playerDying || this.victory || this.player.respawnShield > 0) return
    this.player.hp = Math.max(0, this.player.hp - dmg)
    // attack-direction indicator: bearing to the attacker relative to the
    // aim direction — rel 0 = ahead, +90 = right, 180 = behind
    if (fromDir) {
      const bearing = Math.atan2(fromDir.x, fromDir.z)
      const rel = Math.atan2(Math.sin(bearing - this.player.yaw), Math.cos(bearing - this.player.yaw))
      this.hitArcs.push({ id: (this._arcId = (this._arcId || 0) + 1), rel, at: performance.now() })
      if (this.hitArcs.length > 8) this.hitArcs.shift()
    }
    this.emitHud()
    if (this.player.hp <= 0 && !this.playerDying) {
      this.playerDying = true
      this.deathT = 0
      this.player.zoom = false
      this.player.mesh.visible = true
      const turret = this.player.mesh.userData.turret
      const materials = []
      this.player.mesh.traverse((obj) => { if (obj.isMesh) materials.push([obj, obj.material]) })
      this.playerRestore = {
        position: this.player.mesh.position.clone(), materials,
        turret: turret ? { obj: turret, parent: turret.parent, position: turret.position.clone(), quaternion: turret.quaternion.clone(), scale: turret.scale.clone() } : null,
      }
      this.tankExplode(this.player.mesh)
      this.keys = {}; this.touchDrive = null
      this.finish(false)
    }
  }

  revivePlayer() {
    if (!this.over || !this.playerDying || !this.playerRestore) return false
    const p = this.player, saved = this.playerRestore
    if (saved.turret) {
      const t = saved.turret
      this.wrecks = this.wrecks.filter((w) => w.obj !== t.obj)
      t.parent.add(t.obj)
      t.obj.position.copy(t.position)
      t.obj.quaternion.copy(t.quaternion)
      t.obj.scale.copy(t.scale)
    }
    for (const [obj, material] of saved.materials) {
      if (obj.material !== material) obj.material.dispose()
      obj.material = material
    }
    p.mesh.position.copy(saved.position)
    p.hp = MAX_HP
    p.cooldown = 0
    p.mgHeat = 0
    p.mgOver = false
    p.vel = 0; p.speed = 0; p.gear = 1; p.shiftT = 0
    p.zoom = false
    p.dispersion = 0.15
    p.moving = false
    p.targetYaw = p.yaw
    p.targetPitch = p.pitch
    p.turretReset = false
    p.fireQueued = false
    p.respawnShield = 2.5
    p.lastTrack = null
    this.keys = {}; this.touchDrive = null
    this.playerDying = false
    this.playerRestore = null
    this.deathT = 0
    this.over = false
    this.paused = false
    this.emitHud()
    return true
  }

  finish(win) {
    if (this.over) return
    this.over = true
    document.exitPointerLock?.()
    const time = this.victory?.time ?? Math.round((performance.now() - this.stats.start) / 1000)
    this.onEnd(win
      ? { win: true, stats: { time, shots: this.stats.shots, hits: this.stats.hits, accuracy: this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0, hp: this.player.hp, map: this.theme } }
      : { win: false })
  }

  moveTank(obj, dirX, dirZ, dt) {
    const len = Math.hypot(dirX, dirZ)
    if (len < 1e-4) return false
    const nx = obj.mesh.position.x + (dirX / len) * obj.speed * dt
    const nz = obj.mesh.position.z + (dirZ / len) * obj.speed * dt
    if (Math.abs(nx) > WORLD_HALF - 10 || Math.abs(nz) > WORLD_HALF - 10) return false
    if (isWater(nx, nz)) return false
    // rocks block movement — but always allow escaping if already overlapping:
    // block only moves that take the tank deeper into the rock
    const px = obj.mesh.position.x, pz = obj.mesh.position.z
    for (const rk of this.rocks) {
      const rr = rk.r + obj.radius * 0.7
      const dx = nx - rk.x, dz = nz - rk.z
      const cdx = px - rk.x, cdz = pz - rk.z
      if (dx * dx + dz * dz < rr * rr && dx * dx + dz * dz < cdx * cdx + cdz * cdz) return false
    }
    obj.mesh.position.x = nx
    obj.mesh.position.z = nz
    return true
  }

  // automatic 3-speed gearbox: slow pull-away in 1st, then 2nd and 3rd as speed builds
  updateDrive(p, f, dt) {
    const top = this.movementSpeed * TOP_SPEED
    p.shiftT = Math.max(0, p.shiftT - dt)
    const v = p.vel
    if (f !== 0 && (v === 0 || Math.sign(f) === Math.sign(v))) {
      if (f > 0) {
        const g = GEARS[p.gear - 1]
        if (v >= g.top * top * 0.98 && p.gear < GEARS.length) { p.gear++; p.shiftT = SHIFT_TIME }
        const cur = GEARS[p.gear - 1]
        if (p.shiftT === 0) p.vel = Math.min(v + cur.acc * Math.abs(f) * dt, cur.top * top * Math.abs(f))
        if (p.vel < v) p.vel = Math.max(p.vel, v - COAST_DECEL * dt) // stick eased off
      } else {
        p.vel = Math.max(v - REVERSE_ACC * Math.abs(f) * dt, -REVERSE_TOP * top * Math.abs(f))
      }
    } else {
      const decel = f !== 0 ? BRAKE_DECEL : COAST_DECEL  // opposite key = brake
      p.vel = v > 0 ? Math.max(0, v - decel * dt) : Math.min(0, v + decel * dt)
    }
    // drop back a gear once speed falls well below the lower gear's limit
    while (p.gear > 1 && p.vel < GEARS[p.gear - 2].top * top * 0.8) p.gear--
    if (p.vel <= 0) p.gear = 1
  }

  updatePlayer(dt) {
    // WoT-style: A/D rotate hull, W/S drive forward/back along hull heading.
    // Mouse controls turret yaw + camera independently.
    const p = this.player
    this.alignGun(p)
    if (this.hitArcs.length) this.hitArcs = this.hitArcs.filter((a) => performance.now() - a.at < 1700)
    p.respawnShield = Math.max(0, (p.respawnShield || 0) - dt)
    if (p.turretReset) { p.targetYaw = p.hullYaw; p.targetPitch = 0 } // follows the hull if it turns meanwhile
    const yawDelta = Math.atan2(Math.sin(p.targetYaw - p.yaw), Math.cos(p.targetYaw - p.yaw))
    if (p.turretReset && Math.abs(yawDelta) < 0.005 && Math.abs(p.pitch) < 0.005) p.turretReset = false
    const aimSpeed = (this.mobile ? 1.2 : 1) * (p.turretReset ? 2 : 1)
    // aim + camera run on real frame time: on a slow GPU (city/snow) the 0.05 s sim
    // cap would otherwise make the turret and view lag far behind the mouse
    const adt = this.frameDt ?? dt
    p.yaw += THREE.MathUtils.clamp(yawDelta, -TRAVERSE * aimSpeed * adt, TRAVERSE * aimSpeed * adt)
    p.pitch += THREE.MathUtils.clamp(p.targetPitch - p.pitch, -ELEVATE * aimSpeed * adt, ELEVATE * aimSpeed * adt)
    const prevCd = p.cooldown
    p.cooldown = Math.max(0, p.cooldown - dt)
    if (prevCd > 0 && p.cooldown === 0) this.sfx?.reload() // breech ready clack
    if (p.fireQueued && p.cooldown === 0) this.firePlayer()
    this.updateMG(dt)
    const f = this.touchDrive?.forward ?? ((this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0))
    const r = this.touchDrive?.turn ?? ((this.keys.KeyA ? 1 : 0) - (this.keys.KeyD ? 1 : 0))
    this.updateDrive(p, f, dt)
    p.moving = Math.abs(p.vel) > 0.3 || r !== 0
    this.sfx?.setEngine(f !== 0 || Math.abs(p.vel) > 1)   // engine roar only while driving, silent when hull-pivoting
    p.hullYaw += r * 1.4 * dt
    if (Math.abs(p.vel) > 0.01) {
      const dir = Math.sign(p.vel)
      p.speed = Math.abs(p.vel)
      if (!this.moveTank(p, Math.sin(p.hullYaw) * dir, Math.cos(p.hullYaw) * dir, dt)) p.vel = 0 // hit a wall / bank
      this.knockTrees(p)
    }

    // dispersion: blooms while moving, settles when stationary (WoT aim circle)
    const settle = p.moving ? 0.9 : 0.45
    p.dispersion += ((p.moving ? 0.55 : 0.12) - p.dispersion) * settle * dt
    p.dispersion = THREE.MathUtils.clamp(p.dispersion, 0.05, 1)

    const pos = p.mesh.position
    const sn = Math.sin(p.hullYaw), cs = Math.cos(p.hullYaw)
    // sample near the hull ends/track edges so the long hull doesn't clip into dips and crests
    const L = 4.5, W = 2.2
    const front = surfaceY(pos.x + sn * L, pos.z + cs * L), back = surfaceY(pos.x - sn * L, pos.z - cs * L)
    const right = surfaceY(pos.x + cs * W, pos.z - sn * W), left = surfaceY(pos.x - cs * W, pos.z + sn * W)
    pos.y = Math.max(surfaceY(pos.x, pos.z), (front + back) / 2, (right + left) / 2) + 0.18
    p.mesh.rotation.y = p.hullYaw
    p.mesh.rotation.x = THREE.MathUtils.damp(p.mesh.rotation.x, -Math.atan2(front - back, L * 2), 5, dt)
    p.mesh.rotation.z = THREE.MathUtils.damp(p.mesh.rotation.z, Math.atan2(right - left, W * 2), 5, dt)
    for (const wheel of p.mesh.userData.wheels || []) wheel.rotation.x += p.vel * dt / 0.62

    // turret tracks the mouse aim relative to hull
    const tur = p.mesh.userData.turret
    if (tur) {
      this.setTurretYaw(p.mesh, p.yaw - p.hullYaw)
      if (p.mesh.userData.gun) p.mesh.userData.gun.rotation.x = (p.mesh.userData.gunBase ?? Math.PI / 2) + p.pitch
    }

    // aim direction + crosshair target point on the world
    const aimDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'))
    this.aimDir = aimDir
    // the camera follows the mouse aim at once; the turret slews after it
    const viewDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(p.targetPitch, p.targetYaw, 0, 'YXZ'))

    const target = pos.clone().add(new THREE.Vector3(0, 3.4, 0))
    this.cameraRecoil = THREE.MathUtils.damp(this.cameraRecoil, 0, 9, dt)
    let camPos
    // WoT sniper view: hide own tank so the turret never blocks the sight
    p.mesh.visible = !p.zoom
    if (p.zoom) {
      // sniper mode: camera at the gunner sight, narrow FOV
      camPos = target.clone().addScaledVector(viewDir, 0.5 - this.cameraRecoil * 0.2)
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 28, 10, dt)
    } else {
      // third-person camera behind the turret aim direction
      camPos = target.clone().addScaledVector(viewDir, -p.camDist - this.cameraRecoil).add(new THREE.Vector3(0, 5.2, 0))
      camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 2)
      for (let t = 0.15; t <= 1; t += 0.1) {
        const sample = target.clone().lerp(camPos, t)
        const clearance = heightAt(sample.x, sample.z) + 1.5 - sample.y
        if (clearance > 0) camPos.y += clearance / t
      }
      // never let the camera sink into the tank's own body
      const bodyDist = camPos.distanceTo(target)
      if (bodyDist < 6) camPos.sub(target).setLength(6).add(target)
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.mobile ? 59 : 56, 7, dt)
    }
    const lookTarget = target.clone().addScaledVector(viewDir, p.zoom ? 150 : 7)
    if (!this.cameraInitialized) {
      this.camera.position.copy(camPos)
      this.cameraLookTarget.copy(lookTarget)
      this.cameraInitialized = true
    } else {
      this.camera.position.lerp(camPos, 1 - Math.exp(-7 * adt))
      this.cameraLookTarget.lerp(lookTarget, 1 - Math.exp(-10 * adt))
    }
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(this.cameraLookTarget)
    const sightDirection = this.camera.getWorldDirection(new THREE.Vector3())
    this.aimPoint = this.marchAimPoint(this.camera.position, sightDirection)

    // reticle ring follows the barrel (march the gun's own ray); the crosshair
    // marks where the mouse aims — the ring drifts onto it as the turret catches up
    const ro = (this.reticleOffset ??= { x: 0, y: 0, on: false })
    const co = (this.crosshairOffset ??= { x: 0, y: 0 })
    ro.x = ro.y = co.x = co.y = 0; ro.on = false
    const mz = this.muzzleInfo(p, this.aimDir)
    if (mz) {
      this.gunAimPoint = this.marchAimPoint(mz, this.aimDir)
      if (!p.zoom) {
        ro.on = this.screenOffset(this.gunAimPoint, ro)
        this.screenOffset(this.marchAimPoint(mz, viewDir), co)
      }
    }

    // sun/shadow follows player for crisp shadows across the big map
    this.sun.position.set(pos.x - 150, 155, pos.z + 105)
    this.sun.target.position.copy(pos)
  }

  // --- trees fall over when rammed or shot ---
  fellTree(i) {
    const t = this.trees[i]
    if (!t || !t.alive) return
    t.alive = false
    this.sfx?.treeFall()
    this.fallingTrees.push({ i, t: 0, ang: Math.random() * Math.PI * 2 })
  }

  updateTrees(dt) {
    if (!this.fallingTrees.length) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const qy = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const axis = new THREE.Vector3()
    const off = new THREE.Vector3()
    for (let k = this.fallingTrees.length - 1; k >= 0; k--) {
      const f = this.fallingTrees[k]
      f.t += dt
      const tr = this.trees[f.i]
      const angle = Math.min(f.t * 2.4, Math.PI / 2 - 0.08)
      axis.set(Math.cos(f.ang), 0, Math.sin(f.ang))
      q.setFromAxisAngle(axis, angle)
      if (tr.rot) q.multiply(qy.setFromAxisAngle(up, tr.rot))
      const v = tr.v ?? 0, slot = tr.slot ?? f.i
      const scale = tr.glbScale ?? tr.s
      // trunk pivot at ground (x, h, z); rotate the stored vertical offsets
      off.set(0, tr.glbScale ? 0 : 1.7 * tr.s, 0).applyQuaternion(q)
      m.compose(new THREE.Vector3(tr.x + off.x, tr.h + off.y, tr.z + off.z), q, new THREE.Vector3(scale, scale, scale))
      this.treeMeshes.trunk[v].setMatrixAt(slot, m)
      off.set(0, tr.glbScale ? 0 : 3.2 * tr.s, 0).applyQuaternion(q)
      m.compose(new THREE.Vector3(tr.x + off.x, tr.h + off.y, tr.z + off.z), q, new THREE.Vector3(scale, scale, scale))
      this.treeMeshes.leaf[v].setMatrixAt(slot, m)
      if (angle >= Math.PI / 2 - 0.081) this.fallingTrees.splice(k, 1)
    }
    for (const mesh of this.treeMeshes.trunk) mesh.instanceMatrix.needsUpdate = true
    for (const mesh of this.treeMeshes.leaf) mesh.instanceMatrix.needsUpdate = true
  }

  // tanks knock down trees they drive over
  knockTrees(tank) {
    const p = tank.mesh.position
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i]
      if (!t.alive) continue
      const dx = p.x - t.x, dz = p.z - t.z
      if (dx * dx + dz * dz < (tank.radius + 0.8) ** 2) this.fellTree(i)
    }
    // ramming wrecks cars too
    for (const c of this.cars) {
      if (!c.alive) continue
      const dx = p.x - c.x, dz = p.z - c.z
      if (dx * dx + dz * dz < (tank.radius + 1.5 * CAR_SCALE) ** 2) this.destroyCar(c)
    }
  }

  // --- smoke puffs from damaged / wrecked tanks ---
  puffSmoke(pos, big) {
    if (this.smokes.length > 160) return // each puff is its own draw call
    // shared puff geometry: smoke is emitted constantly (city fires) and must not allocate GPU buffers per puff
    const geos = (this._smokeGeos ??= [0.8, 1.4].map((r) => {
      const g = new THREE.SphereGeometry(r, 8, 8)
      g.userData.shared = true
      return g
    }))
    const m = new THREE.Mesh(
      geos[big ? 1 : 0],
      new THREE.MeshBasicMaterial({ color: big ? 0x1c1c1c : 0x3a3a3a, transparent: true, opacity: 0.55 })
    )
    m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2))
    this.scene.add(m)
    this.smokes.push({ mesh: m, t: 0 })
  }

  updateSmoke(dt) {
    // emit smoke from damaged player / enemies and fresh wrecks
    this._smk = (this._smk || 0) + dt
    if (this._smk > 0.09) {
      this._smk = 0
      const emit = (tank) => {
        const low = tank.hp <= 40 && tank.hp > 0
        if (low) this.puffSmoke(tank.mesh.position, tank.hp <= 20)
      }
      emit(this.player)
      for (const e of this.enemies) if (e.alive) emit(e)
      for (const wr of this.wrecks) if (wr.t < 5) this.puffSmoke(wr.hullPos, true)
      // persistent fire spots: burning buildings & wrecked cars
      const pp = this.player.mesh.position
      for (const fs of this.fireSpots) {
        fs.t += 0.09
        // only fires near the player smoke: the city has ~60 burning buildings
        if (fs.t < fs.dur && (fs.x - pp.x) ** 2 + (fs.z - pp.z) ** 2 < 260 * 260) this.puffSmoke(new THREE.Vector3(fs.x, fs.y, fs.z), Math.random() < 0.4)
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]
      s.t += dt
      s.mesh.position.y += 6 * dt
      if (s.vel) { s.mesh.position.addScaledVector(s.vel, dt); s.vel.multiplyScalar(1 - dt * 2.5) }
      s.mesh.scale.multiplyScalar(1 + dt * 1.2)
      s.mesh.material.opacity = Math.max(0, (s.o0 ?? 0.55) - s.t * (s.rate ?? 0.5))
      if (s.t > 1.4) {
        this.scene.remove(s.mesh)
        s.mesh.material.dispose()
        if (!s.mesh.geometry.userData.shared) s.mesh.geometry.dispose()
        this.smokes.splice(i, 1)
      }
    }
    // falling snow: flakes drift down inside a cloud that follows the player
    if (this.snowPts) {
      const a = this.snowPts.geometry.attributes.position.array
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] -= dt * (5 + (i % 7))
        a[i] += Math.sin(a[i + 1] * 0.25 + i) * 1.6 * dt
        if (a[i + 1] < -20) a[i + 1] = 55 + Math.random() * 10
      }
      this.snowPts.geometry.attributes.position.needsUpdate = true
      const pp = this.player?.mesh.position
      if (pp) this.snowPts.position.set(pp.x, pp.y, pp.z)
    }
  }

  // snowfall cloud: points spread over a box around the player
  buildSnowfall() {
    const N = 1400, arr = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 320
      arr[i * 3 + 1] = Math.random() * 80 - 20
      arr[i * 3 + 2] = (Math.random() - 0.5) * 320
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    this.snowPts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xf4f8ff, size: 0.55, transparent: true, opacity: 0.85,
      sizeAttenuation: true, depthWrite: false,
    }))
    this.snowPts.frustumCulled = false
    this.scene.add(this.snowPts)
  }

  // cracked blue ice for the snow map's frozen water — veins + bubbles
  iceWater() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#9fc4dc'; ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${70 + (Math.random() * 40) | 0},${125 + (Math.random() * 45) | 0},${185 + (Math.random() * 50) | 0},${0.07 + Math.random() * 0.14})`
      ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, 18 + Math.random() * 70, 0, 7); ctx.fill()
    }
    // bright white crack veins — branching random walks
    for (let i = 0; i < 100; i++) {
      ctx.strokeStyle = `rgba(240,248,255,${0.25 + Math.random() * 0.5})`
      ctx.lineWidth = 0.6 + Math.random() * 1.9
      ctx.beginPath(); let x = Math.random() * 512, y = Math.random() * 512; ctx.moveTo(x, y)
      for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90; ctx.lineTo(x, y) }
      ctx.stroke()
    }
    for (let i = 0; i < 300; i++) { // tiny trapped bubbles
      ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.4})`
      ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, 0.5 + Math.random() * 1.6, 0, 7); ctx.fill()
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 20)
    return new THREE.MeshStandardMaterial({ map: tex, color: 0xe2edf6, roughness: 0.28, metalness: 0.12 })
  }

  // flat white snow cover for the snow map — plain canvas, no dirt/rock blend
  snowGround() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#eef2f7'; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 520; i++) {
      ctx.fillStyle = `rgba(${168 + (Math.random() * 40) | 0},${184 + (Math.random() * 40) | 0},${206 + (Math.random() * 40) | 0},${0.1 + Math.random() * 0.3})`
      ctx.beginPath(); ctx.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3.5, 0, 7); ctx.fill()
    }
    const t = new THREE.CanvasTexture(cv)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60)
    return new THREE.MeshStandardMaterial({ map: t, color: 0xf5f8fc, roughness: 0.95 })
  }

  // snow-map cabins: block-style houses with white gable roofs
  buildCabins() {
    const wall = new THREE.MeshStandardMaterial({ color: 0x7a7268, roughness: 0.9 })
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xe4ebf2, roughness: 0.65 })
    for (let i = 0; i < 10; i++) {
      const x = (Math.random() - 0.5) * 420, z = (Math.random() - 0.5) * 420
      const y = heightAt(x, z)
      if (y < WATER_LEVEL + 0.8 || distToRoad(x, z) < 14) continue
      const w = 8 + Math.random() * 4, d = 7 + Math.random() * 4, h = 3.2 + Math.random() * 1.4
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall)
      body.position.y = h / 2; body.castShadow = body.receiveShadow = true
      g.add(body)
      for (const s of [-1, 1]) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, 0.4, d + 0.8), roofMat)
        roof.position.set(s * w * 0.24, h + 0.95, 0)
        roof.rotation.z = -s * 0.62
        roof.castShadow = true
        g.add(roof)
      }
      g.position.set(x, y, z)
      g.rotation.y = Math.random() * Math.PI
      this.scene.add(g)
      this.rocks.push({ x, z, y, r: Math.max(w, d) * 0.6 })
      this.buildings.push({ x, z, w, d })
    }
  }

  // --- destruction: hull and turret stay together as a charred wreck ---
  tankExplode(mesh) {
    this.sfx?.explode()
    this.explode(mesh.position.clone().add(new THREE.Vector3(0, 3, 0)), true)
    this.addCrater(mesh.position.x, mesh.position.z, 7, 1.2)
    this.wrecks.push({ obj: null, hullPos: mesh.position.clone(), t: 0, landed: true })
    // char the hull black — it stays as a burnt wreck
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone()
        o.material.color?.setHex(0x171310)
        o.material.emissive?.setHex(0x000000)
      }
    })
  }

  updateWrecks(dt) {
    for (const w of this.wrecks) {
      w.t += dt
      if (w.landed) continue
      w.vel.y -= 32 * dt
      w.obj.position.addScaledVector(w.vel, dt)
      w.obj.rotation.x += w.av.x * dt
      w.obj.rotation.y += w.av.y * dt
      w.obj.rotation.z += w.av.z * dt
      const g = heightAt(w.obj.position.x, w.obj.position.z) + 1.0
      if (w.obj.position.y <= g) {
        w.obj.position.y = g
        w.landed = true
        this.explode(w.obj.position.clone())
      }
    }
  }

  // --- enemy kamikaze drones ---
  // launched one by one from the enemy side; cruise high, then dive onto the player
  initDrones(side) {
    this.drones = []
    this.droneWarn = null
    this.droneMode = null
    this._beepT = 0
    const n = DRONES[this.theme] ?? 3
    for (let i = 0; i < n; i++) {
      const mesh = this.buildDroneMesh()
      this.swapDroneModel(mesh)
      const a = side + (Math.random() - 0.5) * 1.2, r = 470
      const x = Math.sin(a) * r, z = Math.cos(a) * r
      mesh.position.set(x, groundY(x, z) + DRONE_ALT, z)
      mesh.visible = false
      this.scene.add(mesh)
      this.drones.push({ mesh, state: 'wait', launchT: 18 + i * 12 + Math.random() * 6, life: 0, vel: new THREE.Vector3() })
    }
  }

  // Shahed-style delta-wing loitering munition
  buildDroneMesh() {
    const g = new THREE.Group()
    const mat = (this._droneMat ??= new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.7, metalness: 0.2 }))
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 3.6, 10).rotateX(Math.PI / 2), mat)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 10).rotateX(Math.PI / 2).translate(0, 0, 2.25), mat)
    const wingShape = new THREE.Shape([new THREE.Vector2(0, 1.2), new THREE.Vector2(1.9, -1.6), new THREE.Vector2(-1.9, -1.6)])
    const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false }).rotateX(Math.PI / 2), mat)
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.6), mat)
      fin.position.set(sx * 1.8, 0.3, -1.4)
      g.add(fin)
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }))
    light.position.set(0, 0.35, 0.6)
    g.add(body, nose, wing, light)
    g.userData.light = light
    g.userData.parts = g.children.filter((c) => c !== light)
    g.scale.setScalar(1.4)
    g.traverse((o) => { if (o.isMesh) o.castShadow = true })
    return g
  }

  // drone.glb (Sketchfab, CC-BY-4.0): warhead points along (+x, -z); turn it to +z
  // so lookAt() aims the warhead along the flight path, center it, ~3.6 m across
  prepDroneModel(scene) {
    const inner = new THREE.Group().add(scene.clone(true))
    inner.rotation.y = -Math.PI * 0.75
    inner.updateMatrixWorld(true)
    const bb = new THREE.Box3().setFromObject(inner)
    const size = bb.getSize(new THREE.Vector3())
    inner.scale.setScalar(6 / Math.max(size.x, size.z))
    inner.updateMatrixWorld(true)
    const ctr = new THREE.Box3().setFromObject(inner).getCenter(new THREE.Vector3())
    inner.position.sub(ctr)
    const mat = new THREE.MeshStandardMaterial({ color: 0x4e5559, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })
    inner.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true } })
    return inner
  }

  swapDroneModel(g) {
    if (!this.droneProto || g.userData.glb) return
    for (const c of g.userData.parts) g.remove(c)
    g.scale.setScalar(1)
    g.add(this.droneProto.clone(true))
    g.userData.light.position.set(0, -0.25, 1.85)
    g.userData.light.scale.setScalar(0.7)
    g.userData.glb = true
  }

  destroyDrone(d, hitPlayer = false) {
    if (d.state === 'dead') return
    if (this.droneMode?.d === d && !hitPlayer) this.droneMode.killT = this.droneMode.t
    d.state = 'dead'
    this.explode(d.mesh.position.clone(), hitPlayer)
    this.sfx?.explode()
    this.scene.remove(d.mesh)
  }

  // freeze the battle and cut to the MG sight on the nearest incoming drone
  startDroneDefense(d) {
    d.engaged = true
    this.droneMode = { d, t: 0 }
    this.player.zoom = false
    this.player.throttle = 0
    this.player.vel = 0
    this.sfx?.setEngine(false)
    this.sfx?.beep()
    // swing the sight near the drone so it is on screen, a few degrees off: the player still aims
    const v = d.mesh.position.clone().sub(this.player.mesh.position.clone().add(new THREE.Vector3(0, 3.2, 0)))
    this.player.targetYaw = Math.atan2(v.x, v.z) + (Math.random() - 0.5) * 0.22
    this.player.targetPitch = THREE.MathUtils.clamp(-Math.atan2(v.y, Math.hypot(v.x, v.z)) + (Math.random() - 0.5) * 0.1, DEF_PITCH_UP, PITCH_DOWN)
  }

  endDroneDefense() {
    this.droneMode = null
    this.camera.fov = this.mobile ? 59 : 56
    this.camera.updateProjectionMatrix()
  }

  // MG gunner view: turret snaps to the mouse, only the drone keeps moving
  updateDroneDefense(dt) {
    const m = this.droneMode, p = this.player, d = m.d
    m.t += dt
    if (this.playerDying || this.victory || p.hp <= 0) { this.endDroneDefense(); return }
    p.yaw = p.targetYaw
    p.pitch = p.targetPitch
    this.setTurretYaw(p.mesh, p.yaw - p.hullYaw)
    if (p.mesh.userData.gun) p.mesh.userData.gun.rotation.x = (p.mesh.userData.gunBase ?? Math.PI / 2) + p.pitch
    p.mesh.visible = true

    const aimDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'))
    this.aimDir = aimDir
    const gun = p.mesh.userData.gun
    const eye = (gun ? gun.getWorldPosition(new THREE.Vector3()) : p.mesh.position.clone().add(new THREE.Vector3(0, 3.2, 0)))
      .addScaledVector(aimDir, 1.2).add(new THREE.Vector3(0, 0.5, 0))
    this.camera.position.copy(eye)
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 32, 10, dt)
    this.camera.updateProjectionMatrix()
    this.cameraLookTarget.copy(eye).addScaledVector(aimDir, 200)
    this.camera.lookAt(this.cameraLookTarget)
    this.aimPoint = this.gunAimPoint = eye.clone().addScaledVector(aimDir, 400)
    const ro = (this.reticleOffset ??= { x: 0, y: 0, on: false })
    const co = (this.crosshairOffset ??= { x: 0, y: 0 })
    ro.x = ro.y = co.x = co.y = 0; ro.on = false

    if (d.state === 'dead') {        // shot down: hold a beat, then back to the battle
      if (m.t > (m.killT ??= m.t) + 0.9) this.endDroneDefense()
      return
    }
    const target = p.mesh.position.clone().add(new THREE.Vector3(0, 2.2, 0))
    const pos = d.mesh.position
    const want = target.clone().sub(pos).setLength(DRONE_SPEED * DEF_SLOW)
    d.vel.lerp(want, 1 - Math.exp(-4 * dt))
    pos.addScaledVector(d.vel, dt)
    d.mesh.lookAt(pos.clone().add(d.vel))
    d.life += dt
    d.mesh.userData.light.visible = (d.life * 6) % 1 < 0.5
    const dist = pos.distanceTo(target)
    this.droneWarn = { dist, defense: true, eta: dist / Math.max(1, DRONE_SPEED * DEF_SLOW) }
    this._beepT -= dt
    if (this._beepT <= 0) { this.sfx?.beep(); this._beepT = 0.1 + 0.4 * dist / DRONE_ENGAGE }
    if (dist < DRONE_HIT && !(p.respawnShield > 0)) {   // too slow: it rams home
      this.destroyDrone(d, true)
      this.damagePlayer(this.ai.dmg, d.vel.clone().negate())
      this.endDroneDefense()
    }
  }

  updateDrones(dt) {
    this.droneWarn = null
    if (!this.drones?.length) return
    const p = this.player
    if (this.victory || this.playerDying || p.hp <= 0) {
      for (const d of this.drones) d.mesh.visible = false
      return
    }
    const target = p.mesh.position.clone().add(new THREE.Vector3(0, 2.2, 0))
    let nearest = Infinity
    for (const d of this.drones) {
      if (d.state === 'dead') continue
      if (d.state === 'wait') {
        d.launchT -= dt
        if (d.launchT > 0) continue
        d.state = 'fly'
        d.mesh.visible = true
        d.vel.subVectors(target, d.mesh.position).setY(0).setLength(DRONE_SPEED)
      }
      const pos = d.mesh.position, prev = pos.clone()
      const flat = Math.hypot(target.x - pos.x, target.z - pos.z)
      // cruise at altitude, dive once within ~90 m
      const aim = target.clone()
      if (flat > 90) aim.y = Math.max(groundY(pos.x, pos.z), target.y) + DRONE_ALT
      const want = aim.sub(pos).setLength(DRONE_SPEED * (flat > 90 ? 1 : 1.25))
      d.vel.lerp(want, 1 - Math.exp(-(flat > 90 ? 1.5 : 4) * dt))
      pos.addScaledVector(d.vel, dt)
      d.mesh.lookAt(pos.clone().add(d.vel))
      d.life += dt
      d.mesh.userData.light.visible = (d.life * 3) % 1 < 0.5
      const dist = pos.distanceTo(target)
      nearest = Math.min(nearest, dist)
      if (!d.engaged && !this.droneMode && dist < DRONE_ENGAGE && !this.playerDying && !this.victory && p.hp > 0) {
        this.startDroneDefense(d)
      }
      if (dist < DRONE_HIT && !(p.respawnShield > 0)) {
        this.destroyDrone(d, true)
        this.damagePlayer(this.ai.dmg, d.vel.clone().negate())
      } else if (pos.y <= heightAt(pos.x, pos.z) + 0.5 || d.life > 120 ||
        (this.theme === 'city' && this.hitBuildingWall(prev, pos))) {
        this.destroyDrone(d)
      }
    }
    if (nearest < DRONE_WARN) {
      this.droneWarn = { dist: nearest }
      this._beepT -= dt
      if (this._beepT <= 0) {
        this.sfx?.beep()
        this._beepT = 0.15 + 0.85 * nearest / DRONE_WARN // faster beeps as it closes in
      }
    } else this._beepT = 0
  }

  // --- airdrop supply crates ---
  // nearest clear, dry spot to (x, z): searched in growing rings; keeps far enough
  // from rocks/buildings that the spawn rock-clearing never deletes a building collider
  findSpawn(x, z, fallback) {
    const lim = WORLD_HALF - 30
    const ok = (cx, cz) => Math.abs(cx) < lim && Math.abs(cz) < lim && !isWater(cx, cz) &&
      this.rocks.every((rk) => Math.hypot(cx - rk.x, cz - rk.z) > rk.r + 14)
    for (let ring = 0; ring <= 12; ring++) {
      const rad = ring * 12
      const steps = ring ? 8 + ring * 2 : 1
      const off = Math.random() * Math.PI * 2
      for (let s = 0; s < steps; s++) {
        const a = off + (s / steps) * Math.PI * 2
        const cx = THREE.MathUtils.clamp(x + Math.sin(a) * rad, -lim, lim)
        const cz = THREE.MathUtils.clamp(z + Math.cos(a) * rad, -lim, lim)
        if (ok(cx, cz)) return [cx, cz]
      }
    }
    let [fx, fz] = fallback
    for (let t = 0; t < 40 && isWater(fx, fz); t++) { fx += 8; fz += 8 }
    return [fx, fz]
  }

  randomValidSpot() {
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 25)
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 25)
      if (isWater(x, z)) continue
      let blocked = false
      for (const rk of this.rocks) {
        const dx = x - rk.x, dz = z - rk.z
        if (dx * dx + dz * dz < (rk.r + 4 + DROP_HALF) ** 2) { blocked = true; break }
      }
      if (!blocked) return [x, z]
    }
    return null
  }

  // wooden supply crate: planks, frame, diagonal brace, nails + stencilled HP cross / AP mark
  crateMaterial(type) {
    this._crateMats ??= {}
    if (this._crateMats[type]) return this._crateMats[type]
    const S = 256, cv = document.createElement('canvas')
    cv.width = cv.height = S
    const c = cv.getContext('2d')
    const wood = (x, y, w, h, base) => {
      c.fillStyle = base; c.fillRect(x, y, w, h)
      for (let i = 0; i < h / 2; i++) {
        c.strokeStyle = `rgba(${40 + Math.random() * 30 | 0},${25 + Math.random() * 20 | 0},10,${0.12 + Math.random() * 0.2})`
        c.lineWidth = 0.6 + Math.random()
        const yy = y + Math.random() * h
        c.beginPath(); c.moveTo(x, yy)
        c.bezierCurveTo(x + w * 0.3, yy + (Math.random() - 0.5) * 4, x + w * 0.7, yy + (Math.random() - 0.5) * 4, x + w, yy + (Math.random() - 0.5) * 3)
        c.stroke()
      }
      c.strokeStyle = 'rgba(25,15,6,0.85)'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2)
    }
    const tones = ['#a07848', '#94703f', '#a9814f', '#8c6939', '#9b7445']
    const ph = S / 5
    for (let i = 0; i < 5; i++) wood(0, i * ph, S, ph, tones[i])
    // diagonal brace
    c.save(); c.translate(S / 2, S / 2); c.rotate(-Math.PI / 4)
    wood(-S * 0.72, -16, S * 1.44, 32, '#7e5d33')
    c.restore()
    // outer frame
    const F = 26
    wood(0, 0, S, F, '#77562f'); wood(0, S - F, S, F, '#77562f')
    wood(0, F, F, S - 2 * F, '#7a5931'); wood(S - F, F, F, S - 2 * F, '#7a5931')
    // nails
    c.fillStyle = '#2a2622'
    for (const [x, y] of [[13, 13], [S - 13, 13], [13, S - 13], [S - 13, S - 13], [S / 2, 13], [S / 2, S - 13], [13, S / 2], [S - 13, S / 2]]) {
      c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill()
    }
    // stencil mark
    c.globalAlpha = 0.85
    if (type === 'hp') {
      c.fillStyle = '#e8e2d4'; c.beginPath(); c.arc(S / 2, S / 2, 52, 0, Math.PI * 2); c.fill()
      c.fillStyle = '#c4161c'; c.fillRect(S / 2 - 38, S / 2 - 12, 76, 24); c.fillRect(S / 2 - 12, S / 2 - 38, 24, 76)
    } else {
      c.fillStyle = '#e0b021'; c.fillRect(F, S / 2 - 30, S - 2 * F, 60)
      c.fillStyle = '#1d1a14'; c.font = 'bold 46px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText('AP', S / 2, S / 2 + 2)
    }
    c.globalAlpha = 1
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    return (this._crateMats[type] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }))
  }

  buildDrop(type) {
    const g = new THREE.Group()
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), this.crateMaterial(type))
    crate.position.y = 0.6
    crate.castShadow = true
    g.add(crate)
    // floating icon
    const icon = new THREE.Group()
    if (type === 'hp') {
      const red = new THREE.MeshBasicMaterial({ color: 0xff2222 })
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 0.26), red)
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 0.26), red)
      icon.add(a, b)
    } else {
      const gold = new THREE.MeshBasicMaterial({ color: 0xffc832 })
      for (const dx of [-0.2, 0.2]) {
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 8), gold)
        sh.position.x = dx
        icon.add(sh)
      }
      // "x2" hint: small star burst above
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), gold)
      star.position.y = 0.55
      icon.add(star)
    }
    icon.position.y = 2.6
    g.add(icon)
    g.userData.icon = icon
    g.scale.setScalar(DROP_SCALE)
    return g
  }

  spawnDrop() {
    const spot = this.randomValidSpot()
    if (!spot) return
    // shift drop sites per map so items land in different places each theme
    // (no shift in the city — it could push a crate inside a building)
    const [ox, oz] = this.theme === 'snow' ? [-70, 90] : [0, 0]
    let sx = spot[0] + ox, sz = spot[1] + oz
    if (Math.abs(sx) > WORLD_HALF - 15 || Math.abs(sz) > WORLD_HALF - 15) { sx = spot[0]; sz = spot[1] }
    const type = Math.random() < 0.5 ? 'hp' : 'ap'
    const mesh = this.buildDrop(type)
    mesh.position.set(sx, groundY(sx, sz), sz)
    this.scene.add(mesh)
    this.drops.push({ type, mesh, x: sx, z: sz, t: Math.random() * 6 })
  }

  applyDrop(tank, type) {
    if (type === 'hp') {
      tank.hp = Math.min(MAX_HP, tank.hp + 40)
    } else {
      tank.apT = 15 // attack power x2 for 15 seconds
    }
    this.pickupBurst(tank.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), type)
    this.sfx?.reload()
  }

  // power-up pickup flash — bright glow, light pillar, ground ring, rising sparkles
  pickupBurst(pos, type) {
    const col = type === 'hp' ? 0x7dffa0 : 0xffd060
    const grp = { t: 0, parts: [], sparkles: [] }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.starburstTex(), color: col, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }))
    glow.position.copy(pos)
    glow.scale.setScalar(9)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.6, 16, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    )
    beam.position.copy(pos).y += 8
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    )
    ring.position.set(pos.x, heightAt(pos.x, pos.z) + 0.2, pos.z)
    this.scene.add(glow, beam, ring)
    grp.parts = [glow, beam, ring]
    for (let i = 0; i < (this.mobile ? 5 : 8); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.starburstTex(), color: col, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false,
      }))
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 2.5
      s.position.set(pos.x + Math.cos(a) * r, pos.y - 1 + Math.random() * 2, pos.z + Math.sin(a) * r)
      s.scale.setScalar(0.9 + Math.random() * 1.2)
      this.scene.add(s)
      grp.sparkles.push({ sp: s, vy: 3 + Math.random() * 4 })
    }
    if (this.flashes.length < 3) {
      const l = new THREE.PointLight(col, 140, 35)
      l.position.copy(pos).y += 3
      this.scene.add(l)
      this.flashes.push({ l, t: 0 })
    }
    this.pickups.push(grp)
  }

  updateDrops(dt) {
    // bob + spin icons
    for (const d of this.drops) {
      d.t += dt
      const icon = d.mesh.userData.icon
      icon.position.y = 2.4 + Math.sin(d.t * 2.2) * 0.35
      icon.rotation.y += dt * 1.8
    }
    // pickup check: player + all living enemies
    const all = [this.player, ...this.enemies.filter((e) => e.alive)]
    for (const t of all) {
      if (t.hp <= 0) continue
      t.apT = Math.max(0, (t.apT || 0) - dt)
      const p = t.mesh.position
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i]
        const dx = p.x - d.x, dz = p.z - d.z
        if (dx * dx + dz * dz < (t.radius + DROP_HALF + 1.2) ** 2) {
          this.applyDrop(t, d.type)
          this.scene.remove(d.mesh)
          this.drops.splice(i, 1)
          if (t === this.player) this.emitHud()
        }
      }
    }
    // refresh HUD while the AP buff ticks down
    const apNow = Math.ceil(this.player.apT || 0)
    if (apNow !== this._lastAp) { this._lastAp = apNow; this.emitHud() }
    // keep a few drops available
    this.dropTimer -= dt
    if (this.dropTimer <= 0 && this.drops.length < 4) {
      this.spawnDrop()
      this.dropTimer = 12 + Math.random() * 8
    }
  }

  marchAimPoint(from, dir) {
    // march along the aim ray until it dips below terrain or hits an enemy
    const v = new THREE.Vector3()
    for (let t = 10; t < 700; t += 8) {
      v.copy(from).addScaledVector(dir, t)
      if (v.y < heightAt(v.x, v.z)) return v.clone()
      for (const e of this.enemies) {
        if (e.alive && v.distanceTo(e.mesh.position.clone().add(new THREE.Vector3(0, 2.4, 0))) < e.radius + 1.5) return v.clone()
      }
    }
    return from.clone().addScaledVector(dir, 700)
  }

  updateEnemy(e, dt) {
    if (!e.alive) return
    this.alignGun(e)
    e.cooldown = Math.max(0, e.cooldown - dt)
    e.strafeT -= dt
    if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 2 + Math.random() * 3 }

    const pp = this.player.mesh.position
    const ep = e.mesh.position
    const toPlayer = pp.clone().sub(ep)
    const dist = toPlayer.length()
    const ang = Math.atan2(toPlayer.x, toPlayer.z)

    let tx, tz
    if (e.role === 'hunter') {
      tx = pp.x - Math.sin(ang) * 130
      tz = pp.z - Math.cos(ang) * 130
    } else {
      const side = e.role === 'flankL' ? 1 : -1
      const fa = ang + side * (Math.PI * 0.42)
      tx = pp.x - Math.sin(fa) * 110
      tz = pp.z - Math.cos(fa) * 110
    }

    let mx = tx - ep.x, mz = tz - ep.z
    if (dist < 60) { mx = -toPlayer.x; mz = -toPlayer.z }
    mx += Math.cos(ang) * e.strafe * 0.6
    mz += -Math.sin(ang) * e.strafe * 0.6

    if (!this.moveTank(e, mx, mz, dt)) {
      if (!this.moveTank(e, -mz, mx, dt)) {
        if (!this.moveTank(e, mz, -mx, dt)) this.moveTank(e, -mx, -mz, dt)
      }
    }
    this.knockTrees(e)
    ep.y = groundY(ep.x, ep.z)
    e.mesh.rotation.y = Math.atan2(mx, mz)

    if (e.mesh.userData.turret) this.setTurretYaw(e.mesh, Math.atan2(pp.x - ep.x, pp.z - ep.z) - e.mesh.rotation.y)

    if (dist < this.ai.range && this.player.hp > 0) this.fireEnemy(e, pp)
  }

  updateShells(dt) {
    const p = this.player.mesh.position
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]
      s.life -= dt
      s.vel.y -= 6 * dt
      const prev = s.mesh.position.clone()
      s.mesh.position.addScaledVector(s.vel, dt)
      const sp = s.mesh.position
      let dead = s.life <= 0 || sp.y <= heightAt(sp.x, sp.z)
      let cause = dead ? 'ground' : null
      let wallHit = null
      if (!dead) {
        // shells smash trees down and detonate on rocks
        for (let i = 0; i < this.trees.length; i++) {
          const t = this.trees[i]
          if (!t.alive) continue
          const dx = sp.x - t.x, dz = sp.z - t.z
          if (dx * dx + dz * dz < 2.6 * 2.6 && sp.y < t.h + 9 * t.s) {
            this.fellTree(i); dead = true; cause = 'tree'; break
          }
        }
      }
      if (!dead) {
        for (const c of this.cars) {
          if (!c.alive) continue
          const dx = sp.x - c.x, dz = sp.z - c.z
          if (dx * dx + dz * dz < (2.4 * CAR_SCALE) ** 2 && sp.y < heightAt(c.x, c.z) + 3 * CAR_SCALE) {
            this.destroyCar(c); dead = true; cause = 'car'; break
          }
        }
      }
      if (!dead && this.theme === 'city') {
        wallHit = this.hitBuildingWall(prev, sp)
        if (wallHit) { sp.copy(wallHit.p); dead = true; cause = 'wall' }
      }
      if (!dead) {
        for (const rk of this.rocks) {
          if (rk.bld) continue
          const dx = sp.x - rk.x, dz = sp.z - rk.z
          if (dx * dx + dz * dz < rk.r * rk.r && sp.y < rk.y + rk.r) { dead = true; cause = 'rock'; break }
        }
      }
      if (!dead) {
        if (s.owner === 'player') {
          for (const d of this.drones) {
            if (d.state === 'fly' && sp.distanceTo(d.mesh.position) < 3) { this.destroyDrone(d); dead = true; cause = 'drone'; break }
          }
          for (const e of dead ? [] : this.enemies) {
            if (!e.alive) continue
            if (sp.distanceTo(e.mesh.position.clone().add(new THREE.Vector3(0, 2.4, 0))) < e.radius + 0.6) {
              this.damageEnemy(e, DMG_PLAYER * (this.player.apT > 0 ? 2 : 1))
              dead = true; cause = 'tank'; break
            }
          }
        } else {
          if (this.player.hp > 0 && sp.distanceTo(p.clone().add(new THREE.Vector3(0, 2.2, 0))) < this.player.radius + 0.6) {
            this.damagePlayer(this.ai.dmg * (s.ap > 0 ? 2 : 1), s.vel.clone().negate()); dead = true; cause = 'tank'
          }
        }
      }
      if (dead) {
        if (s.life > 0) {
          this.explode(sp, cause === 'tank')
          if (cause === 'tank') this.sfx?.explode()
          else if (cause !== 'car' && cause !== 'tree') this.sfx?.impact()
          if (wallHit) this.addWallMark(wallHit.p, wallHit.n, (s.ap > 0 || (s.owner === 'player' && this.player.apT > 0) ? 5 : 3.6) * (0.85 + Math.random() * 0.3))
          if (cause === 'ground' || cause === 'tank' || cause === 'rock') this.addCrater(sp.x, sp.z, cause === 'tank' ? 5.5 : 4, cause === 'tank' ? 1 : 0.7)
        }
        this.scene.remove(s.mesh)
        this.shells.splice(i, 1)
      }
    }
  }

  updateExplosions(dt) {
    // light flashes decay fast
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.t += dt
      f.l.intensity *= Math.exp(-14 * dt)
      if (f.t > 0.5) { this.scene.remove(f.l); this.flashes.splice(i, 1) }
    }
    // muzzle starbursts collapse within ~0.18s
    for (let i = this.muzzleFx.length - 1; i >= 0; i--) {
      const m = this.muzzleFx[i]
      m.t += dt
      m.sp.scale.multiplyScalar(Math.max(0, 1 - dt * 5.5))
      if (m.t > 0.18) { this.scene.remove(m.sp); this.muzzleFx.splice(i, 1) }
    }
    // pickup glow: pillar rises, ring expands, sparkles float up — ~1.1s
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]
      pk.t += dt
      const [glow, beam, ring] = pk.parts
      glow.scale.multiplyScalar(Math.max(0.15, 1 - dt * 1.6))
      glow.material.opacity = Math.max(0, 1 - pk.t * 1.4)
      beam.material.opacity = Math.max(0, 0.55 - pk.t * 0.6)
      beam.position.y += dt * 2.5
      ring.scale.setScalar(1 + pk.t * 12)
      ring.material.opacity = Math.max(0, 0.8 - pk.t * 1.1)
      for (const s of pk.sparkles) {
        s.sp.position.y += s.vy * dt
        s.sp.material.opacity = Math.max(0, 1 - pk.t * 1.15)
      }
      if (pk.t > 1.1) {
        for (const m of pk.parts) { this.scene.remove(m); m.geometry?.dispose(); m.material.dispose() }
        for (const s of pk.sparkles) { this.scene.remove(s.sp); s.sp.material.dispose() }
        this.pickups.splice(i, 1)
      }
    }
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i]
      ex.t += dt
      const [core, fire, ring] = ex.parts
      // core: instant bloom, dies in ~0.15s
      core.scale.setScalar((1 + ex.t * 26) * ex.scale)
      core.material.opacity = Math.max(0, 1 - ex.t * 8)
      // fireball: grows slower, dark smoke colour at the tail
      fire.scale.setScalar((1 + ex.t * 10) * ex.scale)
      fire.material.opacity = Math.max(0, 0.85 - ex.t * 1.5)
      fire.position.y += dt * 4
      // shockwave races along the ground
      ring.scale.setScalar(1 + ex.t * 26 * ex.scale)
      ring.material.opacity = Math.max(0, 0.7 - ex.t * 2.2)
      let alive = ex.t < 0.7
      for (const d of ex.debris) {
        if (!d.landed) {
          d.vel.y -= 24 * dt
          d.mesh.position.addScaledVector(d.vel, dt)
          d.mesh.rotation.x += d.rot.x * dt
          d.mesh.rotation.y += d.rot.y * dt
          d.mesh.rotation.z += d.rot.z * dt
          if (d.mesh.position.y <= heightAt(d.mesh.position.x, d.mesh.position.z) + 0.15) d.landed = true
        }
        d.mesh.material.opacity = Math.max(0, 1.2 - ex.t)
        if (ex.t < 1.2) alive = true
      }
      if (!alive) {
        for (const m of ex.parts) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose() }
        for (const d of ex.debris) { this.scene.remove(d.mesh); d.mesh.geometry.dispose() }
        if (ex.debris.length) ex.debris[0].mesh.material.dispose()
        this.explosions.splice(i, 1)
      }
    }
  }

  separateTanks() {
    const all = [this.player, ...this.enemies.filter((e) => e.alive)]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i].mesh.position, b = all[j].mesh.position
        const dx = b.x - a.x, dz = b.z - a.z
        const d = Math.hypot(dx, dz), min = all[i].radius + all[j].radius
        if (d < min && d > 0.01) {
          const push = (min - d) / 2
          const nx = dx / d, nz = dz / d
          if (!isWater(a.x - nx * push, a.z - nz * push)) { a.x -= nx * push; a.z -= nz * push }
          if (!isWater(b.x + nx * push, b.z + nz * push)) { b.x += nx * push; b.z += nz * push }
        }
      }
    }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop)
    const raw = this.clock.getDelta()
    const dt = Math.min(raw, 0.05)
    this.frameDt = Math.min(raw, 0.25)
    if (this.paused || this.over || this.playerDying || this.victory) this.sfx?.setEngine(false)
    if (!this.over && !this.paused) {
      if (this.playerDying) {
        this.deathT += dt
        if (this.deathT > 2.8) this.finish(false)
      } else if (this.victory) {
        this.updateVictory(dt)
      } else if (this.droneMode) {
        this.updateDroneDefense(dt)
      } else if (this.player.hp > 0) {
        this.updatePlayer(dt)
      }
      if (this.droneMode) {
        this.updateBullets(dt)
        this.updateMGFx(dt)
      } else {
      for (const e of this.enemies) this.updateEnemy(e, dt)
      this.updateShells(dt)
      this.updateBullets(dt)
      this.updateMGFx(dt)
      this.separateTanks()
      if (!this.playerDying) this.updateTrackMarks(this.player)
      for (const e of this.enemies) if (e.alive) this.updateTrackMarks(e)
      this.updateDrops(dt)
      this.updateDrones(dt)
      }
    }
    this.updateTrees(dt)
    this.updateWrecks(dt)
    this.updateSmoke(dt)
    this.updateExplosions(dt)
    this.environmentMaterials.update(this.paused || this.over ? 0 : dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this._kd)
    window.removeEventListener('keyup', this._ku)
    window.removeEventListener('mousemove', this._mm)
    window.removeEventListener('pointerdown', this._md)
    window.removeEventListener('pointermove', this._pm)
    window.removeEventListener('mouseup', this._mu)
    window.removeEventListener('contextmenu', this._cm)
    window.removeEventListener('wheel', this._wh)
    window.removeEventListener('resize', this._resize)
    // don't release a lock the next game's canvas may already hold
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.()
    this.bgm?.pause()
    this.sfx?.stopMusic()
    if (this.sfx) { this.sfx.closed = true; this.sfx.ctx.close() }
    this.environmentMaterials.dispose()
    const geometries = new Set(), materials = new Set(), textures = new Set()
    this.scene.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry)
      if (obj.material) for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(mat)
      if (obj.isInstancedMesh) obj.dispose()
      obj.shadow?.dispose()
    })
    for (const [, mat] of this.playerRestore?.materials || []) materials.add(mat)
    for (const mat of materials) {
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value)
      mat.dispose()
    }
    for (const geo of geometries) geo.dispose()
    for (const texture of textures) texture.dispose()
    this.renderer.dispose()
    this.mount.removeChild(this.renderer.domElement)
  }
}
