import { AIError, type AIProvider } from '../ai/provider'
import { applyOps } from './ops'
import {
  SUMMARY_EVERY,
  SUMMARY_JSON_SCHEMA,
  TURN_JSON_SCHEMA,
  buildSummaryPrompt,
  buildSystemPrompt,
  buildTurnPrompt,
} from './prompt'
import {
  activeConstraints,
  activeInfluences,
  checkTable,
  daysBetween,
  driftAmounts,
  dueEvents,
  dueTriggers,
  meets,
  nowOrdinal,
  overdueEvents,
  resolveCheck,
  rollD100,
  routineLocation,
  upcomingEvents,
} from './rules'
import { normalizeState, slotLabel } from './state'
import {
  LEVELS,
  RawOpSchema,
  SummaryResponseSchema,
  type CheckResult,
  type GameState,
  type RawOp,
  type Suggestion,
  type WorldPack,
} from './types'

export interface TurnResult {
  state: GameState
  rejected: { op: RawOp; reason: string }[]
  /** 要約の更新に失敗した場合のメッセージ（ターン自体は成功） */
  warning?: string
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(cleaned)
}

/** 応答を検証する。物語が取れれば成功とし、壊れた操作だけを捨てる */
function readTurnResponse(text: string) {
  const obj = parseJson(text) as Record<string, unknown>
  if (typeof obj?.narrative !== 'string' || !obj.narrative.trim()) throw new Error('narrative がない')
  const suggestions = Array.isArray(obj.suggestions) ? obj.suggestions.map(readSuggestion).filter((x) => !!x).slice(0, 3) : []
  const c = obj.check as { key?: unknown; level?: unknown } | undefined
  const check =
    c && typeof c.key === 'string' && c.key && typeof c.level === 'string' ? { key: c.key, level: c.level } : undefined
  const ops: RawOp[] = []
  const broken: { op: RawOp; reason: string }[] = []
  if (Array.isArray(obj.ops)) {
    for (const raw of obj.ops) {
      const r = RawOpSchema.safeParse(raw)
      if (r.success) ops.push(r.data)
      else broken.push({ op: raw as RawOp, reason: '形式が不正' })
    }
  }
  return { narrative: obj.narrative.trim(), suggestions: suggestions as Suggestion[], ops, broken, check }
}

const isLevel = (v: unknown): v is Suggestion['level'] => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

/** 行動候補を読む（古い形式の文字列にも対応） */
export function readSuggestion(raw: unknown): Suggestion | undefined {
  if (typeof raw === 'string') return raw.trim() ? { text: raw.trim() } : undefined
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as { text?: unknown; key?: unknown; level?: unknown }
  if (typeof o.text !== 'string' || !o.text.trim()) return undefined
  return typeof o.key === 'string' && o.key && isLevel(o.level) ? { text: o.text.trim(), key: o.key, level: o.level } : { text: o.text.trim() }
}

export interface TurnOptions {
  /** 行動候補から選んだとき、その候補（判定を事前に確定させる） */
  chosen?: Suggestion
  /** 乱数（テスト用） */
  rand?: () => number
}

export async function runTurn(
  pack: WorldPack,
  stateIn: GameState,
  action: string,
  ai: AIProvider,
  /** テストでサイコロを固定するため */
  roll: number = rollD100(),
  opts: TurnOptions = {},
): Promise<TurnResult> {
  const rand = opts.rand ?? Math.random
  const state = normalizeState(stateIn)
  // 世界パックを後から足したとき、すでに過ぎた出来事は黙って処理済みにする
  for (const ev of overdueEvents(pack, state)) state.firedEvents[ev.id] = 'skipped'
  const isOpening = state.turn === 0 && state.cards.length === 0
  const shownAction = isOpening ? '（ゲーム開始）' : action.trim()
  if (!isOpening && !shownAction) throw new AIError('other', '行動を入力してください。')

  // 時刻に達した固定イベント（分岐かどうかはコードが判定し、分岐の中身はAIが決める）と、
  // ステータスが条件を満たしたきっかけの出来事
  const due = [...dueEvents(pack, state), ...dueTriggers(pack, state)]

  // 出来事に付いた判定は、AIに渡す前にコードが振って確定させる
  const eventChecks: Record<string, CheckResult[]> = {}
  const eventRollEffects: RawOp[] = []
  for (const d of due) {
    const ev = pack.events.find((e) => e.id === d.id)
    for (const r of ev?.rolls ?? []) {
      if (!meets(state, r.when)) continue
      const res = resolveCheck(pack, state, r.key, r.level, Math.floor(rand() * 100) + 1, r.label)
      if (!res) continue
      ;(eventChecks[d.id] ??= []).push(res)
      eventRollEffects.push(...(res.ok ? r.onSuccess : r.onFail))
    }
  }

  // 候補から選んだ行動に判定が付いていれば、これも先に確定させる
  const chosen = opts.chosen && opts.chosen.text === action.trim() ? opts.chosen : undefined
  const playerCheck = chosen?.key ? resolveCheck(pack, state, chosen.key, chosen.level, roll) : undefined

  const request = {
    kind: 'turn' as const,
    system: buildSystemPrompt(pack),
    prompt: buildTurnPrompt(pack, state, shownAction, isOpening, {
      due,
      upcoming: upcomingEvents(pack, state, 6),
      checkTable: checkTable(pack, state, roll),
      influences: activeInfluences(pack, state),
      constraints: activeConstraints(pack, state),
      playerCheck,
      eventChecks,
    }),
    schema: TURN_JSON_SCHEMA,
    meta: { pack, state, action: shownAction },
  }

  // JSONが崩れていたら1回だけ再試行する
  let parsed: ReturnType<typeof readTurnResponse> | undefined
  let lastError = ''
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const text = await ai.generate(request)
    try {
      parsed = readTurnResponse(text)
    } catch (e) {
      lastError = (e as Error).message
    }
  }
  if (!parsed) throw new AIError('bad_output', `AIの応答を読み取れませんでした（${lastError}）。もう一度送ってください。`)

  const whenBefore = { date: state.date, slot: slotLabel(pack, state) }
  // 判定はコードが決める：候補で確定済みのもの、なければAIが申告した check（古い形式の check 操作も受ける）
  const legacy = parsed.ops.find((o) => o.op === 'check')
  const aiCheck = parsed.check ?? (legacy ? { key: legacy.key, level: legacy.level } : undefined)
  const turnCheck = playerCheck ?? (aiCheck ? resolveCheck(pack, state, aiCheck.key, aiCheck.level, roll) : undefined)
  const checks: CheckResult[] = [...(turnCheck ? [turnCheck] : []), ...Object.values(eventChecks).flat()]

  const applied = applyOps(state, pack, parsed.ops.filter((o) => o.op !== 'check'), { roll })
  let next = applied.state
  const trusted = (ops: RawOp[]) => {
    if (!ops.length) return
    const r = applyOps(next, pack, ops, { roll, trusted: true })
    next = r.state
    applied.changes.push(...r.changes)
  }
  // 判定に成功した能力はコードが伸ばす
  for (const c of checks) {
    const growth = pack.playerStats.find((d) => d.key === c.key)?.growth ?? 0
    if (c.ok && growth) trusted([{ op: 'adjust_stat', target: 'player', key: c.key, delta: growth }])
  }
  trusted(eventRollEffects)
  // 固定イベントを処理済みにし、原作どおりのときは決まった効果を適用する
  const happened: string[] = []
  for (const d of due) {
    if (d.mode === 'canon') trusted(d.effects)
    next.firedEvents[d.id] = d.mode
    const title = d.title + (d.mode === 'diverged' ? '（原作から分岐）' : '')
    happened.push(title)
    next.events.push({ turn: state.turn + 1, date: d.date ?? state.date, text: title })
  }
  // 経過した日数ぶん、世界の数値が勝手に動く（例：ほかの生徒の寮点）
  for (const dr of driftAmounts(pack, next, daysBetween(state.date, next.date), rand)) {
    const def = pack.worldStats.find((w) => w.key === dr.key)
    if (!def) continue
    const before = next.worldStats[def.key]
    next.worldStats[def.key] = Math.min(def.max, Math.max(def.min, before + dr.delta))
    const d = next.worldStats[def.key] - before
    if (d) applied.changes.push(`${def.label} ${d > 0 ? '+' : ''}${d}${dr.label ? `（${dr.label}）` : ''}`)
  }

  // 人物の居場所：このターンにAIが動かした人物はそのまま、それ以外は日課どおりに動く
  const nowOrd = nowOrdinal(pack, next)
  const slot = slotLabel(pack, next)
  for (const c of Object.values(next.characters)) {
    if (c.location !== state.characters[c.id]?.location) c.movedAt = nowOrd
    if (c.status !== 'active' || (c.movedAt !== undefined && c.movedAt >= nowOrd)) continue
    const loc = routineLocation(pack, c.id, next.date, slot, next.flags.holiday === true)
    if (loc) c.location = loc
  }

  next.turn = state.turn + 1
  next.suggestions = parsed.suggestions
  next.cards.push({
    turn: next.turn,
    date: whenBefore.date,
    slot: whenBefore.slot,
    action: shownAction,
    narrative: parsed.narrative,
    changes: applied.changes,
    events: happened.length ? happened : undefined,
    checks: checks.length ? checks : undefined,
  })
  next.updatedAt = Date.now()

  const result: TurnResult = { state: next, rejected: [...parsed.broken, ...applied.rejected] }

  // 10ターンごとに要約を更新する（失敗してもターンは成立させる）
  if (next.turn - next.summarizedThroughTurn >= SUMMARY_EVERY) {
    try {
      const fresh = next.cards.filter((c) => c.turn > next.summarizedThroughTurn)
      const text = await ai.generate({
        kind: 'summary',
        system: 'あなたは物語の記録係です。事実だけを簡潔にまとめます。',
        prompt: buildSummaryPrompt(next.summary, fresh),
        schema: SUMMARY_JSON_SCHEMA,
        meta: { pack, state: next, action: '' },
      })
      const s = SummaryResponseSchema.parse(parseJson(text))
      next.summary = s.summary
      next.summarizedThroughTurn = next.turn
    } catch (e) {
      result.warning = `要約の更新に失敗しました（次のターンで再試行します）：${(e as Error).message}`
    }
  }

  return result
}
