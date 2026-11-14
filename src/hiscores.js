const KEY = 'tankcmd.hiscores'
const NAME_KEY = 'tankcmd.lastName'
export const MAX_SCORES = 10    // rows on the TOP board
const MAX_STORED = 500          // every win is kept so players outside the TOP 10 still get a rank
export const NAME_MAX = 12

// win bonus + remaining HP + accuracy + speed (bonus runs out after 5 minutes)
export const calcScore = ({ hp = 0, accuracy = 0, time = 0 }) =>
  3000 + hp * 20 + accuracy * 20 + Math.max(0, 300 - time) * 10

const byRank = (a, b) => b.score - a.score || a.time - b.time || a.date - b.date

export function loadAll() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list)
      ? list.filter((e) => e && typeof e.score === 'number' && typeof e.name === 'string').sort(byRank)
      : []
  } catch {
    return []
  }
}

export const loadScores = () => loadAll().slice(0, MAX_SCORES)

export function qualifies(score) {
  const list = loadScores()
  return list.length < MAX_SCORES || score > list[list.length - 1].score
}

export function addScore({ name, score, time, map }) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim().slice(0, NAME_MAX), score, time, map, date: Date.now(),
  }
  const list = [...loadAll(), entry].sort(byRank)
  const rank = list.indexOf(entry) + 1
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_STORED)))
    localStorage.setItem(NAME_KEY, entry.name)
  } catch { /* storage full or blocked */ }
  return { id: entry.id, rank }
}

// rank of a specific entry, or else the best entry under the given name
export function standing(all, id, name) {
  let i = id ? all.findIndex((e) => e.id === id) : -1
  const n = name?.trim().toLowerCase()
  if (i < 0 && n) i = all.findIndex((e) => e.name.trim().toLowerCase() === n)
  return i < 0 ? null : { entry: all[i], rank: i + 1 }
}

export function lastName() {
  try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' }
}

export const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
