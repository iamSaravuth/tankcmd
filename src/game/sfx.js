import fireUrl from '../assets/fire.mp3'

// Synthesized sound effects + background music (no audio files needed)
export class SoundFX {
  constructor(volumes) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    this.fx = this.ctx.createGain()
    this.fx.connect(this.master)
    this.musicLevel = 1
    this.setVolumes(volumes)
    this.musicOn = false
    this.buffers = {}
    this.offsets = {}
    this.closed = false
    // preload royalty-free mp3 SFX; synth methods stay as fallback
    for (const n of ['explode', 'reload', 'impact', 'treeFalls']) this._load(n, `${import.meta.env.BASE_URL}sfx/${n}.mp3`)
    this._load('fire', fireUrl) // bundled asset (src/assets/fire.mp3)
  }

  // 0..1 levels from the Sound options tab
  setVolumes({ master = 1, effects = 1, music = 1 } = {}) {
    this.master.gain.value = 0.5 * master
    this.fx.gain.value = effects
    this.musicLevel = music
    if (this.musicGain) this.musicGain.gain.value = 0.22 * music
  }

  _load(name, url) {
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error('Audio unavailable'); return r.arrayBuffer() })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((b) => {
        if (this.closed) return
        let onset = b.length
        for (let channel = 0; channel < b.numberOfChannels; channel++) {
          const data = b.getChannelData(channel)
          const first = data.findIndex((sample) => Math.abs(sample) > 0.008)
          if (first >= 0) onset = Math.min(onset, first)
        }
        this.offsets[name] = onset < b.length ? Math.max(0, onset / b.sampleRate - 0.003) : 0
        this.buffers[name] = b
      })
      .catch(() => {})
  }

  _playBuf(name, vol = 1) {
    const b = this.buffers[name]
    if (!b) return false
    const src = this.ctx.createBufferSource()
    src.buffer = b
    const g = this.ctx.createGain()
    g.gain.value = vol
    src.connect(g).connect(this.fx)
    src.start(0, this.offsets[name] || 0)
    return true
  }

  _noise(dur) {
    const n = this.ctx.sampleRate * dur
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    return src
  }

  // cannon fire: real sample plus a layered synth boom for punch
  fire() {
    this._playBuf('fire', 1.0)
    const t = this.ctx.currentTime
    const nz = this._noise(0.35)
    const nf = this.ctx.createBiquadFilter()
    nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.5
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(1.1, t)
    ng.gain.exponentialRampToValueAtTime(0.01, t + 0.35)
    nz.connect(nf).connect(ng).connect(this.fx)
    nz.start(t)
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4)
    const og = this.ctx.createGain()
    og.gain.setValueAtTime(1.0, t)
    og.gain.exponentialRampToValueAtTime(0.01, t + 0.45)
    o.connect(og).connect(this.fx)
    o.start(t); o.stop(t + 0.45)
  }

  // big explosion boom
  explode() {
    if (this._playBuf('explode', 0.9)) return
    const t = this.ctx.currentTime
    const nz = this._noise(1.0)
    const nf = this.ctx.createBiquadFilter()
    nf.type = 'lowpass'
    nf.frequency.setValueAtTime(1200, t)
    nf.frequency.exponentialRampToValueAtTime(80, t + 0.9)
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(1.0, t)
    ng.gain.exponentialRampToValueAtTime(0.01, t + 1.0)
    nz.connect(nf).connect(ng).connect(this.fx)
    nz.start(t)
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(90, t)
    o.frequency.exponentialRampToValueAtTime(28, t + 0.8)
    const og = this.ctx.createGain()
    og.gain.setValueAtTime(0.9, t)
    og.gain.exponentialRampToValueAtTime(0.01, t + 0.85)
    o.connect(og).connect(this.fx)
    o.start(t); o.stop(t + 0.9)
  }

  // coaxial MG round: short sharp crack
  mg() {
    const t = this.ctx.currentTime
    if (!this._mgNoise) {
      const n = (this.ctx.sampleRate * 0.07) | 0
      this._mgNoise = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
      const d = this._mgNoise.getChannelData(0)
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    }
    const nz = this.ctx.createBufferSource()
    nz.buffer = this._mgNoise
    const nf = this.ctx.createBiquadFilter()
    nf.type = 'bandpass'; nf.frequency.value = 1400 + Math.random() * 400; nf.Q.value = 0.8
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(0.55, t)
    ng.gain.exponentialRampToValueAtTime(0.01, t + 0.07)
    nz.connect(nf).connect(ng).connect(this.fx)
    nz.start(t)
    const o = this.ctx.createOscillator()
    o.type = 'square'
    o.frequency.setValueAtTime(180, t)
    o.frequency.exponentialRampToValueAtTime(60, t + 0.05)
    const og = this.ctx.createGain()
    og.gain.setValueAtTime(0.22, t)
    og.gain.exponentialRampToValueAtTime(0.01, t + 0.05)
    o.connect(og).connect(this.fx)
    o.start(t); o.stop(t + 0.06)
  }

  // shell hits ground/rock: dull thud + debris
  impact() {
    if (this._playBuf('impact', 0.7)) return
    const t = this.ctx.currentTime
    const nz = this._noise(0.3)
    const nf = this.ctx.createBiquadFilter()
    nf.type = 'lowpass'; nf.frequency.value = 500
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(0.5, t)
    ng.gain.exponentialRampToValueAtTime(0.01, t + 0.3)
    nz.connect(nf).connect(ng).connect(this.fx)
    nz.start(t)
  }

  // drone proximity warning: short high square-wave beep
  beep() {
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    o.type = 'square'; o.frequency.value = 1450
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.18, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    o.connect(g).connect(this.fx)
    o.start(t); o.stop(t + 0.1)
  }

  // score pickup: quick rising two-note chime
  score() {
    const t = this.ctx.currentTime
    for (const [f, d] of [[880, 0], [1320, 0.07]]) {
      const o = this.ctx.createOscillator()
      o.type = 'triangle'; o.frequency.value = f
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + d)
      g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.18)
      o.connect(g).connect(this.fx)
      o.start(t + d); o.stop(t + d + 0.2)
    }
  }

  // tree fall: crackling down-sweep (throttled — tanks can fell many trees at once)
  treeFall() {
    const t = this.ctx.currentTime
    if (this._lastTree && t - this._lastTree < (this.buffers.treeFalls ? 0.3 : 0.12)) return
    this._lastTree = t
    if (this._playBuf('treeFalls', 0.8)) return
    const nz = this._noise(0.5)
    const nf = this.ctx.createBiquadFilter()
    nf.type = 'bandpass'
    nf.frequency.setValueAtTime(1800, t)
    nf.frequency.exponentialRampToValueAtTime(200, t + 0.45)
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(0.5, t)
    ng.gain.exponentialRampToValueAtTime(0.01, t + 0.5)
    nz.connect(nf).connect(ng).connect(this.fx)
    nz.start(t)
  }

  // reload finished: shell racked into the breech
  reload() {
    if (this._playBuf('reload', 0.8)) return
    const t = this.ctx.currentTime
    const nz = this._noise(0.08)
    const nf = this.ctx.createBiquadFilter()
    nf.type = 'bandpass'; nf.frequency.value = 2400; nf.Q.value = 2
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(0.4, t)
    ng.gain.exponentialRampToValueAtTime(0.01, t + 0.08)
    nz.connect(nf).connect(ng).connect(this.fx)
    nz.start(t)
  }

  // diesel engine rumble while the tank drives (synth loop, pitch rises with throttle)
  setEngine(moving) {
    if (!moving) { this._engineOff(); return }
    if (this._engine) return
    const ctx = this.ctx, t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(0.16, t, 0.2)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'; f.frequency.value = 240
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 52
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 26
    const nz = this._noise(2); nz.loop = true
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 160
    const ng = ctx.createGain(); ng.gain.value = 0.3
    o1.connect(f); o2.connect(f); nz.connect(nf).connect(ng).connect(f)
    f.connect(g).connect(this.fx)
    o1.start(); o2.start(); nz.start()
    // slow lugging wobble so it feels like a diesel under load
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9
    const lg = ctx.createGain(); lg.gain.value = 6
    lfo.connect(lg).connect(o1.frequency)
    lfo.start()
    this._engine = { g, nodes: [o1, o2, nz, lfo] }
  }

  _engineOff() {
    if (!this._engine) return
    const e = this._engine
    e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15)
    setTimeout(() => e.nodes.forEach((n) => { try { n.stop() } catch {} }), 600)
    this._engine = null
  }

  // Seven Nation Army bassline loop + drums (saw bass, kick, hat)
  startMusic() {
    if (this.musicOn) return
    this.musicOn = true
    const ctx = this.ctx
    this.musicGain = ctx.createGain()
    this.musicGain.gain.value = 0.22 * this.musicLevel
    this.musicGain.connect(this.master)

    const N = { E2: 82.4, G2: 98, A2: 110, B1: 61.7, C2: 65.4, D2: 73.4 }
    // [note, beats] — the iconic riff
    const riff = [
      ['E2', 1], ['E2', 0.5], ['G2', 0.5], ['E2', 0.5], ['D2', 0.5],
      ['C2', 1.25], ['B1', 2.5],
    ]
    const bpm = 122, beat = 60 / bpm
    const barLen = riff.reduce((a, r) => a + r[1], 0) * beat

    const scheduleBar = (t0) => {
      let t = t0
      for (const [note, beats] of riff) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = N[note]
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'; f.frequency.value = 700
        const g = ctx.createGain()
        const d = beats * beat
        g.gain.setValueAtTime(0.6, t)
        g.gain.setValueAtTime(0.6, t + d * 0.8)
        g.gain.linearRampToValueAtTime(0.001, t + d)
        o.connect(f).connect(g).connect(this.musicGain)
        o.start(t); o.stop(t + d + 0.05)
        t += d
      }
      // drums: kick on each beat, hats on offbeats
      for (let b = 0; b < Math.floor(barLen / beat); b++) {
        const kt = t0 + b * beat
        const k = ctx.createOscillator()
        k.frequency.setValueAtTime(110, kt)
        k.frequency.exponentialRampToValueAtTime(45, kt + 0.1)
        const kg = ctx.createGain()
        kg.gain.setValueAtTime(0.5, kt)
        kg.gain.exponentialRampToValueAtTime(0.01, kt + 0.15)
        k.connect(kg).connect(this.musicGain)
        k.start(kt); k.stop(kt + 0.16)
        const ht = kt + beat / 2
        const h = this._noise(0.03)
        const hg = ctx.createGain()
        hg.gain.setValueAtTime(0.12, ht)
        hg.gain.exponentialRampToValueAtTime(0.01, ht + 0.03)
        h.connect(hg).connect(this.musicGain)
        h.start(ht)
      }
    }
    const loop = () => {
      if (!this.musicOn) return
      scheduleBar(this.ctx.currentTime + 0.05)
      this._musicTimer = setTimeout(loop, barLen * 1000 - 40)
    }
    loop()
  }

  stopMusic() {
    this.musicOn = false
    clearTimeout(this._musicTimer)
  }
}
