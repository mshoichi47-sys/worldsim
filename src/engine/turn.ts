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
import { slotLabel } from './state'
import { RawOpSchema, SummaryResponseSchema, type GameState, type RawOp, type WorldPack } from './types'

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
  const suggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions.filter((s): s is string => typeof s === 'string' && s.trim() !== '').slice(0, 3)
    : []
  const ops: RawOp[] = []
  const broken: { op: RawOp; reason: string }[] = []
  if (Array.isArray(obj.ops)) {
    for (const raw of obj.ops) {
      const r = RawOpSchema.safeParse(raw)
      if (r.success) ops.push(r.data)
      else broken.push({ op: raw as RawOp, reason: '形式が不正' })
    }
  }
  return { narrative: obj.narrative.trim(), suggestions, ops, broken }
}

export async function runTurn(
  pack: WorldPack,
  state: GameState,
  action: string,
  ai: AIProvider,
): Promise<TurnResult> {
  const isOpening = state.turn === 0 && state.cards.length === 0
  const shownAction = isOpening ? '（ゲーム開始）' : action.trim()
  if (!isOpening && !shownAction) throw new AIError('other', '行動を入力してください。')

  const request = {
    kind: 'turn' as const,
    system: buildSystemPrompt(pack),
    prompt: buildTurnPrompt(pack, state, shownAction, isOpening),
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
  const applied = applyOps(state, pack, parsed.ops)
  const next = applied.state
  next.turn = state.turn + 1
  next.suggestions = parsed.suggestions
  next.cards.push({
    turn: next.turn,
    date: whenBefore.date,
    slot: whenBefore.slot,
    action: shownAction,
    narrative: parsed.narrative,
    changes: applied.changes,
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
