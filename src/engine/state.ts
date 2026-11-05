import type { GameState, StatDef, WorldPack } from './types'

const initialOf = (d: StatDef) => d.initial ?? d.min

export function createInitialState(pack: WorldPack): GameState {
  const worldStats = Object.fromEntries(pack.worldStats.map((d) => [d.key, initialOf(d)]))
  const playerStats = Object.fromEntries(pack.playerStats.map((d) => [d.key, initialOf(d)]))
  const characters: GameState['characters'] = {}
  for (const c of pack.characters) {
    const stats = Object.fromEntries(pack.characterStats.map((d) => [d.key, c.stats[d.key] ?? initialOf(d)]))
    characters[c.id] = { id: c.id, name: c.name, location: c.location, status: 'active', stats, memories: [] }
  }
  return {
    schemaVersion: 1,
    worldId: pack.id,
    turn: 0,
    date: pack.time.start,
    slotIndex: 0,
    worldStats,
    player: {
      name: pack.player.name,
      location: pack.player.location,
      stats: playerStats,
      inventory: [...pack.player.inventory],
    },
    characters,
    flags: {},
    events: [],
    summary: '',
    summarizedThroughTurn: 0,
    hiddenPlot: '',
    suggestions: [],
    cards: [],
    updatedAt: Date.now(),
  }
}

/** 'YYYY-MM-DD' に日数を足す（UTCで計算して日付のずれを防ぐ） */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export function slotLabel(pack: WorldPack, state: GameState): string | undefined {
  return pack.time.slots?.[state.slotIndex]
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

export function formatWhen(pack: WorldPack, state: GameState): string {
  const s = slotLabel(pack, state)
  return s ? `${formatDate(state.date)}・${s}` : formatDate(state.date)
}
