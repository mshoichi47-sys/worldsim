import type { Condition, GameState, StatDef, WorldEvent, WorldPack } from './types'

/* ========== 時間の通し番号（日付×時間帯） ========== */

const slotCount = (pack: WorldPack) => Math.max(1, pack.time.slots?.length ?? 0)
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

export function ordinal(pack: WorldPack, date: string, slotIndex: number): number {
  return dayNumber(date) * slotCount(pack) + slotIndex
}

export function fromOrdinal(pack: WorldPack, ord: number): { date: string; slotIndex: number } {
  const n = slotCount(pack)
  const day = Math.floor(ord / n)
  return { date: new Date(day * 86_400_000).toISOString().slice(0, 10), slotIndex: ord - day * n }
}

export function eventOrdinal(pack: WorldPack, ev: WorldEvent): number {
  const i = ev.slot ? (pack.time.slots?.indexOf(ev.slot) ?? -1) : 0
  return ordinal(pack, ev.date, Math.max(0, i))
}

export const nowOrdinal = (pack: WorldPack, s: GameState) => ordinal(pack, s.date, s.slotIndex)

/** 現在より後で、まだ起きていない最初の固定イベントの時刻 */
export function nextEventOrdinal(pack: WorldPack, s: GameState): number | undefined {
  const now = nowOrdinal(pack, s)
  let best: number | undefined
  for (const ev of pack.events) {
    if (s.firedEvents[ev.id]) continue
    const o = eventOrdinal(pack, ev)
    if (o > now && (best === undefined || o < best)) best = o
  }
  return best
}

/* ========== 条件 ========== */

function statValue(s: GameState, target: string, key: string): number | undefined {
  if (target === 'world') return s.worldStats[key]
  if (target === 'player') return s.player.stats[key]
  return s.characters[target]?.stats[key]
}

export function meets(s: GameState, c: Condition | undefined): boolean {
  if (!c) return true
  for (const [k, v] of Object.entries(c.flags ?? {})) if (s.flags[k] !== v) return false
  for (const [k, v] of Object.entries(c.notFlags ?? {})) if (s.flags[k] === v) return false
  for (const r of c.stats ?? []) {
    const v = statValue(s, r.target, r.key)
    if (v === undefined) return false
    if (r.min !== undefined && v < r.min) return false
    if (r.max !== undefined && v > r.max) return false
  }
  for (const id of c.alive ?? []) if (s.characters[id]?.status === 'dead') return false
  return true
}

/* ========== 固定イベント ========== */

export interface DueEvent {
  event: WorldEvent
  mode: 'canon' | 'alt' | 'skipped'
  /** AIに渡す、このターンに起きること */
  text: string
}

/** 時刻に達した、まだ処理していない固定イベント（古い順） */
export function dueEvents(pack: WorldPack, s: GameState): DueEvent[] {
  const now = nowOrdinal(pack, s)
  return pack.events
    .filter((ev) => !s.firedEvents[ev.id] && eventOrdinal(pack, ev) <= now)
    .sort((a, b) => eventOrdinal(pack, a) - eventOrdinal(pack, b))
    .map((event) => {
      if (meets(s, event.requires)) return { event, mode: 'canon' as const, text: event.canon }
      if (event.alt) return { event, mode: 'alt' as const, text: event.alt }
      return { event, mode: 'skipped' as const, text: '' }
    })
}

/** まだ起きていない固定イベント（近い順） */
export function upcomingEvents(pack: WorldPack, s: GameState, limit: number, onlyPublic = false): WorldEvent[] {
  const now = nowOrdinal(pack, s)
  return pack.events
    .filter((ev) => !s.firedEvents[ev.id] && eventOrdinal(pack, ev) > now && (!onlyPublic || ev.public))
    .sort((a, b) => eventOrdinal(pack, a) - eventOrdinal(pack, b))
    .slice(0, limit)
}

/* ========== 判定（サイコロ） ========== */

export const CHECK_LEVELS = ['易', '普通', '難', '至難'] as const
export type CheckLevel = (typeof CHECK_LEVELS)[number]
const LEVEL_MOD: Record<CheckLevel, number> = { 易: 20, 普通: 0, 難: -25, 至難: -50 }

/** ステータスを0〜100に直した値に難度補正を足した成功率（5〜95%） */
export function checkChance(def: StatDef, value: number, level: CheckLevel): number {
  const scaled = ((value - def.min) / (def.max - def.min)) * 100
  return Math.min(95, Math.max(5, Math.round(scaled + LEVEL_MOD[level])))
}

export function checkSucceeds(def: StatDef, value: number, level: CheckLevel, roll: number): boolean {
  return roll <= checkChance(def, value, level)
}

export const checkableStats = (pack: WorldPack) => pack.playerStats.filter((d) => d.checkable)

/** このターンの判定結果表（AIに渡す） */
export function checkTable(pack: WorldPack, s: GameState, roll: number): string {
  return checkableStats(pack)
    .map((d) => {
      const v = s.player.stats[d.key]
      const r = CHECK_LEVELS.map((l) => `${l}${checkSucceeds(d, v, l, roll) ? '○' : '×'}`).join(' ')
      return `${d.key}（${d.label} ${v}）：${r}`
    })
    .join('\n')
}

export function rollD100(): number {
  return Math.floor(Math.random() * 100) + 1
}
