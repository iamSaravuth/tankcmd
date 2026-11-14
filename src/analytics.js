// Fire-and-forget usage stats. Set VITE_STATS_ENDPOINT (e.g. in .env.local) to
// enable; while it's empty nothing is sent.
const ENDPOINT = import.meta.env.VITE_STATS_ENDPOINT || ''
const VISITOR_KEY = 'tankcmd.visitorId'

const newId = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)

function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) { id = newId(); localStorage.setItem(VISITOR_KEY, id) }
    return id
  } catch {
    return 'anonymous'
  }
}

const sessionId = newId()

export function track(event, data = {}) {
  if (!ENDPOINT) return
  const body = JSON.stringify({
    event, ...data,
    visitorId: visitorId(), sessionId,
    ts: new Date().toISOString(),
    page: location.pathname, referrer: document.referrer || null,
    lang: navigator.language, screen: `${screen.width}x${screen.height}`,
    mobile: matchMedia('(pointer: coarse)').matches,
  })
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
}

let visited = false
export function trackVisit() {
  if (visited) return
  visited = true
  track('visit')
}

export const trackPlay = (map) => track('play', { map })
