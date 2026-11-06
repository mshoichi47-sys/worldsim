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
  fromOrdinal,
  nextEventOrdinal,
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
  PACES,
  RawOpSchema,
  SummaryResponseSchema,
  type CheckResult,
  type GameState,
  type Pace,
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
  const nextPace = (PACES as readonly unknown[]).includes(obj.next_pace) ? (obj.next_pace as Pace) : undefined
  return { narrative: obj.narrative.trim(), suggestions: suggestions as Suggestion[], ops, broken, check, nextPace }
}

const isLevel = (v: unknown): v is Suggestion['level'] => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

/** 行動候補を読む（古い形式の文字列にも対応） */
export function readSuggestion(raw: unknown): Suggestion | undefined {
  if (typeof raw === 'string') return raw.trim() ? { text: raw.trim() } : undefined
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as { text?: unknown; key?: unknown; level?: unknown; path?: unknown }
  if (typeof o.text !== 'string' || !o.text.trim()) return undefined
  const out: Suggestion = { text: o.text.trim() }
  if (typeof o.key === 'string' && o.key && isLevel(o.level)) Object.assign(out, { key: o.key, level: o.level })
  if (typeof o.path === 'string' && o.path) out.path = o.path
  return out
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

  // このターンの時間の進み方。予定の出来事が起きるターンは必ず「場面」
  const paced = !!pack.time.digestDays
  const pace: Pace | undefined = paced ? (dueEvents(pack, state).length ? '場面' : (state.pace ?? '日々')) : undefined

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
      pace,
      sceneTurns: state.sceneTurns ?? 0,
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

  // 時間の2段階：場面では時計をほぼ止め（1ターン最大1時間帯）、日々では数日まとめて進める
  let dateEnd: string | undefined
  if (pace) {
    const n = Math.max(1, pack.time.slots?.length ?? 1)
    const before = nowOrdinal(pack, state)
    let after = nowOrdinal(pack, next)
    if (pace === '場面') {
      after = Math.min(after, before + 1)
    } else {
      const [minD, maxD] = pack.time.digestDays!
      const d0 = Math.floor(before / n)
      const days = Math.floor(after / n) - d0
      // 下限より短ければ下限の日の朝まで、上限より長ければ上限の日の朝まで
      if (days < minD) after = (d0 + minD) * n
      else if (days > maxD) after = (d0 + maxD) * n
      const ev = nextEventOrdinal(pack, state)
      if (ev !== undefined && ev < after) after = ev
      if (Math.floor(after / n) > d0) dateEnd = fromOrdinal(pack, after - 1).date
    }
    const t = fromOrdinal(pack, Math.max(before, after))
    next.date = t.date
    next.slotIndex = t.slotIndex
  }

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
  // 候補から選んだ「道」が進む（判定の成否で進み方が変わる）
  const path = chosen?.path ? pack.paths.find((p) => p.id === chosen.path) : undefined
  if (path) {
    const gain = playerCheck ? (playerCheck.ok ? path.gain.success : path.gain.fail) : path.gain.plain
    trusted([{ op: 'adjust_stat', target: 'player', key: path.stat, delta: gain }])
  }
  // 固定イベントを処理済みにし、原作どおりのときは決まった効果を適用する
  const happened: string[] = []
  for (const d of due) {
    if (d.mode === 'canon') trusted(d.effects)
    next.firedEvents[d.id] = d.mode
    const title = d.title + (d.mode === 'diverged' ? '（原作から分岐）' : '')
    happened.push(title)
    next.events.push({ turn: state.turn + 1, date: d.date ?? state.date, text: title })
  }
  // 経過した日数ぶん、世界の数値が勝手に動く（例：ほかの生徒の寮点）。
  // この仕組みより前の古いセーブは、開始日からの分をまとめて追いつかせる
  const driftFrom = state.driftedThrough ?? pack.time.start
  for (const dr of driftAmounts(pack, next, daysBetween(driftFrom, next.date), rand)) {
    const def = pack.worldStats.find((w) => w.key === dr.key)
    if (!def) continue
    const before = next.worldStats[def.key]
    next.worldStats[def.key] = Math.min(def.max, Math.max(def.min, before + dr.delta))
    const d = next.worldStats[def.key] - before
    if (d) applied.changes.push(`${def.label} ${d > 0 ? '+' : ''}${d}${dr.label ? `（${dr.label}）` : ''}`)
  }

  next.driftedThrough = next.date

  // 人物の居場所：このターンにAIが動かした人物はそのまま、それ以外は日課どおりに動く
  const nowOrd = nowOrdinal(pack, next)
  const slot = slotLabel(pack, next)
  for (const c of Object.values(next.characters)) {
    if (c.location !== state.characters[c.id]?.location) c.movedAt = nowOrd
    if (c.status !== 'active' || (c.movedAt !== undefined && c.movedAt >= nowOrd)) continue
    const loc = routineLocation(pack, c.id, next.date, slot, next.flags.holiday === true)
    if (loc) c.location = loc
  }

  if (pace) {
    next.sceneTurns = pace === '場面' ? (state.sceneTurns ?? 0) + 1 : 0
    // 場面が長引きすぎたら、次は日々に戻す
    next.pace = next.sceneTurns >= 6 ? '日々' : (parsed.nextPace ?? '日々')
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
    dateEnd: dateEnd && dateEnd !== whenBefore.date ? dateEnd : undefined,
    pace,
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
