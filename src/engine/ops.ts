import { checkSucceeds, fromOrdinal, nextEventOrdinal, nowOrdinal, type CheckLevel } from './rules'
import type { GameState, RawOp, StatDef, WorldPack } from './types'

export interface ApplyResult {
  state: GameState
  /** 人が読める変化の一覧（ストーリーカードに表示） */
  changes: string[]
  /** 捨てた操作と理由（デバッグ用） */
  rejected: { op: RawOp; reason: string }[]
}

const MAX_DAYS_PER_TURN = 366
const MAX_MEMORIES = 30
const MAX_EVENTS = 500
const MAX_PLOT_NOTES = 20

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function limitDelta(def: StatDef, delta: number): number {
  const cap = def.maxDelta ?? Math.max(1, Math.round((def.max - def.min) * 0.2))
  return clamp(Math.round(delta), -cap, cap)
}

function findDef(defs: StatDef[], key: string | undefined): StatDef | undefined {
  if (!key) return undefined
  return defs.find((d) => d.key === key || d.label === key)
}

/**
 * AIが提案した操作を検証し、許可されたものだけを適用する。
 * 元の state は変更しない。
 */
export function applyOps(
  state: GameState,
  pack: WorldPack,
  ops: RawOp[],
  /** このターンのサイコロ（判定に使う） */
  ctx: { roll?: number } = {},
): ApplyResult {
  const s: GameState = structuredClone(state)
  const changes: string[] = []
  const rejected: ApplyResult['rejected'] = []
  const reject = (op: RawOp, reason: string) => rejected.push({ op, reason })

  const charOf = (target: string | undefined) => {
    if (!target) return undefined
    return s.characters[target] ?? Object.values(s.characters).find((c) => c.name === target)
  }
  const locationOk = (loc: string) => pack.locations.length === 0 || pack.locations.includes(loc)

  for (const op of ops) {
    switch (op.op) {
      case 'adjust_stat': {
        if (typeof op.delta !== 'number' || !Number.isFinite(op.delta) || op.delta === 0) {
          reject(op, 'delta がない')
          break
        }
        const target = op.target ?? 'world'
        if (target === 'world') {
          const def = findDef(pack.worldStats, op.key)
          if (!def) { reject(op, '未定義の世界ステータス'); break }
          const before = s.worldStats[def.key]
          s.worldStats[def.key] = clamp(before + limitDelta(def, op.delta), def.min, def.max)
          pushChange(changes, def.label, before, s.worldStats[def.key])
        } else if (target === 'player') {
          const def = findDef(pack.playerStats, op.key)
          if (!def) { reject(op, '未定義のプレイヤーステータス'); break }
          const before = s.player.stats[def.key]
          s.player.stats[def.key] = clamp(before + limitDelta(def, op.delta), def.min, def.max)
          pushChange(changes, def.label, before, s.player.stats[def.key])
        } else {
          const c = charOf(target)
          const def = findDef(pack.characterStats, op.key)
          if (!c) { reject(op, '存在しない人物'); break }
          if (!def) { reject(op, '未定義の人物ステータス'); break }
          if (c.status === 'dead') { reject(op, '死亡した人物'); break }
          const before = c.stats[def.key]
          c.stats[def.key] = clamp(before + limitDelta(def, op.delta), def.min, def.max)
          pushChange(changes, `${c.name}の${def.label}`, before, c.stats[def.key])
        }
        break
      }
      case 'set_flag': {
        if (!op.key || op.value === undefined) { reject(op, 'key/value がない'); break }
        s.flags[op.key] = op.value
        break
      }
      case 'move': {
        if (!op.location || !locationOk(op.location)) { reject(op, '未定義の場所'); break }
        if ((op.target ?? 'player') === 'player') {
          s.player.location = op.location
          changes.push(`移動：${op.location}`)
        } else {
          const c = charOf(op.target)
          if (!c || c.status === 'dead') { reject(op, '移動できない人物'); break }
          c.location = op.location
        }
        break
      }
      case 'set_status': {
        const c = charOf(op.target)
        if (!c || !op.status) { reject(op, '人物または状態がない'); break }
        if (c.status === 'dead') { reject(op, '死亡した人物は戻せない'); break }
        if (c.status !== op.status) {
          c.status = op.status
          const label = { active: '登場', absent: '不在', dead: '死亡' }[op.status]
          changes.push(`${c.name}：${label}`)
        }
        break
      }
      case 'add_memory': {
        const c = charOf(op.target)
        if (!c || !op.text) { reject(op, '人物またはテキストがない'); break }
        c.memories.push(op.text.slice(0, 200))
        if (c.memories.length > MAX_MEMORIES) c.memories.splice(0, c.memories.length - MAX_MEMORIES)
        break
      }
      case 'add_item': {
        if (!op.item) { reject(op, 'item がない'); break }
        s.player.inventory.push(op.item)
        changes.push(`入手：${op.item}`)
        break
      }
      case 'remove_item': {
        const i = op.item ? s.player.inventory.indexOf(op.item) : -1
        if (i < 0) { reject(op, '持っていない'); break }
        s.player.inventory.splice(i, 1)
        changes.push(`失った：${op.item}`)
        break
      }
      case 'log_event': {
        if (!op.text) { reject(op, 'text がない'); break }
        s.events.push({ turn: s.turn + 1, date: s.date, text: op.text.slice(0, 200) })
        if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS)
        break
      }
      case 'advance_time': {
        const days = clamp(Math.round(op.days ?? 0), 0, MAX_DAYS_PER_TURN)
        const slots = Math.max(0, Math.round(op.slots ?? 0))
        const n = Math.max(1, pack.time.slots?.length ?? 0)
        const now = nowOrdinal(pack, s)
        // 日数だけ進めたときは、その日の最初の時間帯にする
        let target = slots > 0 ? now + days * n + slots : now + days * n - (days > 0 ? s.slotIndex : 0)
        if (target <= now) break
        // 固定イベントを飛び越えない：その直前（イベントの時刻）で止める
        const next = nextEventOrdinal(pack, s)
        if (next !== undefined && next < target) {
          target = next
          changes.push('予定の出来事の前で時間が止まった')
        }
        const t = fromOrdinal(pack, target)
        s.date = t.date
        s.slotIndex = t.slotIndex
        break
      }
      case 'check': {
        const def = findDef(pack.playerStats, op.key)
        if (!def || !def.checkable) { reject(op, '判定に使えないステータス'); break }
        if (!op.level || ctx.roll === undefined) { reject(op, '難度またはサイコロがない'); break }
        const ok = checkSucceeds(def, s.player.stats[def.key], op.level as CheckLevel, ctx.roll)
        changes.push(`判定 ${def.label}（${op.level}）：${ok ? '成功' : '失敗'}`)
        break
      }
      case 'plot_note': {
        if (!op.text) { reject(op, 'text がない'); break }
        s.plotNotes.push(op.text.slice(0, 300))
        if (s.plotNotes.length > MAX_PLOT_NOTES) s.plotNotes.splice(0, s.plotNotes.length - MAX_PLOT_NOTES)
        break
      }
      default:
        reject(op, '未知の操作')
    }
  }

  return { state: s, changes, rejected }
}

function pushChange(changes: string[], label: string, before: number, after: number) {
  if (before === after) return
  const d = after - before
  changes.push(`${label} ${d > 0 ? '+' : ''}${d}`)
}
