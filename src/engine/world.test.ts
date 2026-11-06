import { describe, expect, it } from 'vitest'
import type { AIProvider } from '../ai/provider'
import hogwartsPack from '../worlds/hogwarts/pack.json'
import { applyOps } from './ops'
import { activeConstraints, driftAmounts, routineLocation } from './rules'
import { createInitialState, normalizeState } from './state'
import { readSuggestion, runTurn } from './turn'
import { WorldPackSchema, type GameState } from './types'

const pack = WorldPackSchema.parse(hogwartsPack)
globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage

const scripted = (body: object = {}): AIProvider & { prompts: string[] } => {
  const prompts: string[] = []
  return {
    label: 'scripted',
    prompts,
    async generate(req) {
      prompts.push(req.prompt)
      if (req.kind === 'summary') return JSON.stringify({ summary: '要約' })
      return JSON.stringify({ narrative: '本文', check: { key: '', level: 'なし' }, suggestions: [], ops: [], ...body })
    },
  }
}
/** 9/1の出来事を済ませた状態 */
const afterArrival = (): GameState => {
  const s = createInitialState(pack)
  s.firedEvents.kings_cross = 'canon'
  s.firedEvents.sorting = 'canon'
  return s
}
const fixedRand = (v: number) => () => v

describe('判定はコードが決める', () => {
  it('候補から選んだ行動は、AIを呼ぶ前に判定が確定し、成功すると能力が伸びる', async () => {
    const ai = scripted({ check: { key: 'potions', level: '至難' } }) // AIの申告は無視される
    const s = afterArrival()
    const chosen = { text: '浮遊術を練習する', key: 'charms', level: '易' as const }
    const r = await runTurn(pack, s, chosen.text, ai, 10, { chosen })
    expect(ai.prompts[0]).toContain('判定（確定済み）：呪文学（易・成功率50%）→ 成功')
    expect(r.state.cards.at(-1)?.checks?.[0]).toMatchObject({ key: 'charms', ok: true, chance: 50 })
    expect(r.state.player.stats.charms).toBe(32) // growth 2
  })

  it('自由入力ではAIが申告した判定をコードが同じサイコロで解決する', async () => {
    const r = await runTurn(pack, afterArrival(), '杖を振る', scripted({ check: { key: 'charms', level: '難' } }), 50)
    expect(r.state.cards.at(-1)?.checks?.[0]).toMatchObject({ statLabel: '呪文学', level: '難', ok: false })
    expect(r.state.player.stats.charms).toBe(30)
  })

  it('古い形式の check 操作も受け付ける', async () => {
    const r = await runTurn(pack, afterArrival(), '杖を振る', scripted({ check: undefined, ops: [{ op: 'check', key: 'charms', level: '易' }] }), 10)
    expect(r.state.cards.at(-1)?.checks?.[0].ok).toBe(true)
  })

  it('行動候補は文字列でもオブジェクトでも読める', () => {
    expect(readSuggestion('見回す')).toEqual({ text: '見回す' })
    expect(readSuggestion({ text: '飛ぶ', key: 'flying', level: '難' })).toEqual({ text: '飛ぶ', key: 'flying', level: '難' })
    expect(readSuggestion({ text: '話す', key: '', level: 'なし' })).toEqual({ text: '話す' })
  })
})

describe('数値の伸びの制限', () => {
  it('同じ数値に何度足しても、1ターンの合計は上限まで', () => {
    const s = createInitialState(pack)
    const r = applyOps(s, pack, [
      { op: 'adjust_stat', target: 'player', key: 'wit', delta: 3 },
      { op: 'adjust_stat', target: 'player', key: 'wit', delta: 3 },
      { op: 'adjust_stat', target: 'player', key: 'wit', delta: 3 },
    ])
    expect(r.state.player.stats.wit).toBe(43) // maxDelta 3
  })

  it('高い数値ほど上がりにくい', () => {
    const s = createInitialState(pack)
    s.player.stats.charms = 85
    s.player.stats.potions = 65
    const r = applyOps(s, pack, [
      { op: 'adjust_stat', target: 'player', key: 'charms', delta: 5 },
      { op: 'adjust_stat', target: 'player', key: 'potions', delta: 5 },
    ])
    expect(r.state.player.stats.charms).toBe(86)
    expect(r.state.player.stats.potions).toBe(68)
  })

  it('AIが文字列で返した真偽値のフラグをそろえる', () => {
    const r = applyOps(createInitialState(pack), pack, [{ op: 'set_flag', key: 'x', value: 'true' }])
    expect(r.state.flags.x).toBe(true)
    const old = normalizeState({ ...createInitialState(pack), flags: { y: 'true' } })
    expect(old.flags.y).toBe(true)
  })
})

describe('世界が勝手に動く', () => {
  it('日がたつと、ほかの寮の寮点も動く（休暇中は止まる）', () => {
    const s = createInitialState(pack)
    const d = driftAmounts(pack, s, 10, fixedRand(0.99))
    expect(d.find((x) => x.key === 'points_slytherin')?.delta).toBe(40)
    expect(d.find((x) => x.key === 'points_hufflepuff')?.delta).toBe(30)
    s.flags.holiday = true
    expect(driftAmounts(pack, s, 10, fixedRand(0.99))).toEqual([])
  })

  it('時間が進んだターンに寮点が動き、カードに出る', async () => {
    const s = afterArrival()
    s.date = '1991-09-20'
    for (const ev of pack.events) if (ev.date <= '1991-09-20') s.firedEvents[ev.id] = 'canon'
    const r = await runTurn(pack, s, '週末を過ごす', scripted({ ops: [{ op: 'advance_time', days: 3 }] }), 50, { rand: fixedRand(0.99) })
    expect(r.state.worldStats.points_ravenclaw).toBe(12)
    expect(r.state.cards.at(-1)?.changes).toContain('寮点：レイブンクロー +12（ほかの生徒）')
  })

  it('人物は日課どおりに移動し、AIが動かした人物はその時間帯のあいだ留まる', async () => {
    expect(routineLocation(pack, 'ron', '1991-09-06', '午前の授業')).toBe('魔法薬学の教室') // 金曜
    expect(routineLocation(pack, 'hermione', '1991-09-07', '放課後')).toBe('図書館') // 土曜
    expect(routineLocation(pack, 'ron', '1991-12-23', '午前の授業', true)).toBe('グリフィンドール塔') // 休暇中
    const s = afterArrival()
    s.date = '1991-09-03' // 火曜
    s.slotIndex = 0
    const r = await runTurn(
      pack,
      s,
      'ハグリッドを誘う',
      scripted({ ops: [{ op: 'move', target: 'hagrid', location: '大広間' }, { op: 'advance_time', slots: 1 }] }),
      50,
    )
    expect(r.state.characters.ron.location).toBe('呪文学の教室')
    expect(r.state.characters.snape.location).toBe('魔法薬学の教室')
    expect(r.state.characters.hagrid.location).toBe('大広間')
    const r2 = await runTurn(pack, r.state, '授業に出る', scripted({ ops: [{ op: 'advance_time', slots: 1 }] }), 50)
    expect(r2.state.characters.hagrid.location).toBe('ハグリッドの小屋')
  })
})

describe('出来事の判定と時期', () => {
  it('学年末試験は科目ごとにコードが振り、結果がフラグに残る', async () => {
    const s = createInitialState(pack)
    s.date = '1992-06-01'
    s.slotIndex = 1
    for (const ev of pack.events) if (ev.date < '1992-06-01') s.firedEvents[ev.id] = 'canon'
    s.player.stats.charms = 100
    s.player.stats.history = 0
    const ai = scripted()
    const r = await runTurn(pack, s, '試験を受ける', ai, 50, { rand: fixedRand(0.5) })
    expect(ai.prompts[0]).toContain('判定（確定済み）：試験：呪文学（パイナップルのタップダンス）：呪文学（普通・成功率95%）→ 成功')
    expect(r.state.flags.exam_charms).toBe('合格')
    expect(r.state.flags.exam_history).toBe('不合格')
    expect(r.state.cards.at(-1)?.checks).toHaveLength(6)
  })

  it('条件付きの判定は、条件を満たすときだけ振る', async () => {
    const s = createInitialState(pack)
    s.date = '1992-05-09'
    s.slotIndex = 5
    for (const ev of pack.events) if (ev.id !== 'norbert_departure' && ev.date <= '1992-05-09') s.firedEvents[ev.id] = 'canon'
    const r1 = await runTurn(pack, s, '寮で眠る', scripted(), 50, { rand: fixedRand(0.99) })
    expect(r1.state.cards.at(-1)?.checks).toBeUndefined()
    expect(r1.state.worldStats.points_gryffindor).toBe(0) // 0未満にはならない
    s.flags.player_with_norbert = true
    const r2 = await runTurn(pack, s, '一緒に運ぶ', scripted(), 50, { rand: fixedRand(0.99) })
    expect(r2.state.cards.at(-1)?.checks?.[0].ok).toBe(false)
    expect(r2.state.flags.player_in_detention).toBe(true)
  })

  it('時期の制約は期限まで渡り、過ぎると外れる', () => {
    const s = createInitialState(pack)
    expect(activeConstraints(pack, s).some((t) => t.includes('賢者の石'))).toBe(true)
    s.date = '1992-06-05'
    expect(activeConstraints(pack, s).some((t) => t.includes('賢者の石'))).toBe(false)
  })

  it('世界パックに後から足した、すでに過ぎた出来事は黙って処理済みにする', async () => {
    const s = createInitialState(pack)
    s.date = '1991-12-12'
    for (const ev of pack.events) if (ev.date <= '1991-10-31') s.firedEvents[ev.id] = 'canon'
    const ai = scripted()
    const r = await runTurn(pack, s, '様子を見る', ai, 50)
    expect(r.state.firedEvents.first_match).toBe('skipped')
    expect(r.state.cards.at(-1)?.events).toBeUndefined()
    expect(ai.prompts[0]).toContain('クリスマス休暇の始まり')
  })

  it('1年目の出来事は日付順に学年末まで並ぶ', () => {
    const dates = pack.events.map((e) => e.date)
    expect([...dates].sort()).toEqual(dates)
    expect(pack.events.at(-1)?.id).toBe('train_home')
    for (const ev of pack.events) for (const r of ev.rolls) expect(pack.playerStats.find((d) => d.key === r.key)?.checkable).toBe(true)
    for (const c of pack.characters) {
      const t = typeof c.routine === 'string' ? pack.routines[c.routine] : c.routine
      for (const loc of Object.values(t ?? {})) expect(pack.locations).toContain(loc)
    }
  })
})
