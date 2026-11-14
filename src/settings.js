const KEY = 'tankcmd.settings'

export const GRAPHICS = ['high', 'medium', 'low']
export const DEFAULTS = { graphics: 'high', master: 100, effects: 100, music: 100, invertY: false, sensitivity: 100 }

export function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }
    if (!GRAPHICS.includes(s.graphics)) s.graphics = DEFAULTS.graphics
    for (const k of ['master', 'effects', 'music']) s[k] = Math.min(100, Math.max(0, Number(s[k]) || 0))
    s.invertY = s.invertY === true
    s.sensitivity = Math.min(200, Math.max(25, Number(s.sensitivity) || DEFAULTS.sensitivity))
    return s
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage full or blocked */ }
}

// effective 0..1 gain for a channel ('effects' | 'music'), master applied
export const channelVolume = (s, channel) => (s.master / 100) * (s[channel] / 100)
