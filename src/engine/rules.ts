import type { CheckResult, Condition, GameState, StatDef, WorldEvent, WorldPack } from './types'

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

/* ========== 固定イベント・きっかけの出来事 ========== */

/** AIがいつでも立てられる「この出来事の前提が変わった」印のフラグ名 */
export const altFlag = (eventId: string) => `alt:${eventId}`

export interface DueEvent {
  id: string
  title: string
  /** 原作どおりなら起きること／きっかけの出来事の内容 */
  text: string
  branchHint?: string
  /** canon：原作どおり ／ diverged：前提が変わっていて、中身はAIが決める */
  mode: 'canon' | 'diverged'
  /** 分岐の理由（AIが残したメモ、または条件が崩れたこと） */
  reason?: string
  /** 分岐したときの参考例 */
  example?: string
  /** 原作どおりのときにコードが適用する操作 */
  effects: WorldEvent['effects']
  /** 年表に載せる日付 */
  date?: string
  kind: 'event' | 'trigger'
}

/** 時刻に達した、まだ処理していない固定イベント（古い順）。分岐かどうかはコードが判定する */
export function dueEvents(pack: WorldPack, s: GameState): DueEvent[] {
  const now = nowOrdinal(pack, s)
  return pack.events
    .filter((ev) => !s.firedEvents[ev.id] && eventOrdinal(pack, ev) <= now)
    .sort((a, b) => eventOrdinal(pack, a) - eventOrdinal(pack, b))
    .map((ev): DueEvent => {
      const note = s.flags[altFlag(ev.id)]
      const broken = !meets(s, ev.requires)
      const diverged = broken || (note !== undefined && note !== false)
      return {
        id: ev.id,
        title: ev.title,
        text: ev.canon,
        branchHint: ev.branchHint,
        mode: diverged ? 'diverged' : 'canon',
        reason: diverged
          ? [typeof note === 'string' ? note : '', broken ? 'これまでの展開で、原作どおりに起きる前提が崩れている' : '']
              .filter(Boolean)
              .join('／')
          : undefined,
        example: diverged ? ev.alt : undefined,
        effects: ev.effects,
        date: ev.date,
        kind: 'event',
      }
    })
}

/** 条件を満たした、まだ起きていない「きっかけの出来事」 */
export function dueTriggers(pack: WorldPack, s: GameState): DueEvent[] {
  return pack.triggers
    .filter((t) => !s.firedEvents[`trigger:${t.id}`] && meets(s, t.when))
    .map((t) => ({ id: `trigger:${t.id}`, title: t.title, text: t.text, mode: 'canon', effects: t.effects, kind: 'trigger' }))
}

/** 今効いている影響の説明 */
export function activeInfluences(pack: WorldPack, s: GameState): string[] {
  return pack.influences.filter((i) => meets(s, i.when)).map((i) => i.text)
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

/* ========== 判定の解決 ========== */

/** 判定1回分を解決する。使えないステータスなら undefined */
export function resolveCheck(
  pack: WorldPack,
  s: GameState,
  key: string | undefined,
  level: string | undefined,
  roll: number,
  label = '',
): CheckResult | undefined {
  const def = pack.playerStats.find((d) => d.checkable && (d.key === key || d.label === key))
  if (!def || !level || !(CHECK_LEVELS as readonly string[]).includes(level)) return undefined
  const lv = level as CheckLevel
  const v = s.player.stats[def.key]
  return {
    key: def.key,
    label,
    statLabel: def.label,
    level: lv,
    chance: checkChance(def, v, lv),
    ok: checkSucceeds(def, v, lv, roll),
  }
}

export const checkLine = (c: CheckResult) =>
  `${c.label ? c.label + '：' : ''}${c.statLabel}（${c.level}・成功率${c.chance}%）→ ${c.ok ? '成功' : '失敗'}`

/* ========== 日ごとの変動 ========== */

export const daysBetween = (a: string, b: string) => dayNumber(b) - dayNumber(a)

/** 経過日数ぶんの変動量を数値ごとに合計する */
export function driftAmounts(pack: WorldPack, s: GameState, days: number, rand: () => number = Math.random) {
  const out: { key: string; label: string; delta: number }[] = []
  if (days <= 0) return out
  for (const d of pack.drift) {
    if (!meets(s, d.when)) continue
    const [lo, hi] = d.perDay
    let sum = 0
    for (let i = 0; i < days; i++) sum += lo + Math.floor(rand() * (hi - lo + 1))
    if (sum !== 0) out.push({ key: d.key, label: d.label, delta: sum })
  }
  return out
}

/* ========== 日課 ========== */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 人物がこの日・この時間帯にいるはずの場所。holiday が true の日（休暇中）は毎日「休:」の日課を使う */
export function routineLocation(
  pack: WorldPack,
  charId: string,
  date: string,
  slot: string | undefined,
  holidayFlag = false,
): string | undefined {
  const def = pack.characters.find((c) => c.id === charId)
  if (!def?.routine || !slot) return undefined
  const table = typeof def.routine === 'string' ? pack.routines[def.routine] : def.routine
  if (!table) return undefined
  const wd = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
  const holiday = holidayFlag || wd === '土' || wd === '日'
  if (holiday) return table[`休:${slot}`] ?? table[slot]
  return table[`${wd}:${slot}`] ?? table[slot]
}

/* ========== 時期の制約 ========== */

export function activeConstraints(pack: WorldPack, s: GameState): string[] {
  return pack.constraints
    .filter((c) => (!c.until || s.date < c.until) && !(c.unless && meets(s, c.unless)))
    .map((c) => c.text)
}

/** 予定の時刻を1日以上過ぎてもまだ処理されていない出来事（世界パックを後から足したときに起きる） */
export function overdueEvents(pack: WorldPack, s: GameState): WorldEvent[] {
  const n = slotCount(pack)
  const now = nowOrdinal(pack, s)
  return pack.events.filter((ev) => !s.firedEvents[ev.id] && eventOrdinal(pack, ev) < now - n)
}
