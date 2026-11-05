import { describe, expect, it } from 'vitest'
import type { AIProvider } from '../ai/provider'
import hogwartsPack from '../worlds/hogwarts/pack.json'
import { applyOps } from './ops'
import { activeInfluences, checkChance, dueEvents, dueTriggers, meets, nowOrdinal, ordinal } from './rules'
import { createInitialState } from './state'
import { runTurn } from './turn'
import { WorldPackSchema } from './types'

const pack = WorldPackSchema.parse(hogwartsPack)
globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage

/** 決まった応答を返すAI */
const scripted = (ops: object[] = []): AIProvider & { prompts: string[] } => {
  const prompts: string[] = []
  return {
    label: 'scripted',
    prompts,
    async generate(req) {
      prompts.push(req.prompt)
      if (req.kind === 'summary') return JSON.stringify({ summary: '要約' })
      return JSON.stringify({ narrative: '本文', suggestions: [], ops })
    },
  }
}

describe('ホグワーツの世界パック', () => {
  it('検証を通り、イベントの時間帯と場所が定義どおり', () => {
    for (const ev of pack.events) if (ev.slot) expect(pack.time.slots).toContain(ev.slot)
    for (const c of pack.characters) if (c.location) expect(pack.locations).toContain(c.location)
    for (const p of pack.map?.places ?? []) expect(pack.locations).toContain(p.name)
  })
})

describe('判定', () => {
  it('ステータスと難度で成功率が決まる', () => {
    const def = pack.playerStats.find((d) => d.key === 'charms')!
    expect(checkChance(def, 30, '易')).toBe(50)
    expect(checkChance(def, 30, '難')).toBe(5)
    expect(checkChance(def, 100, '易')).toBe(95)
  })

  it('check はサイコロで成否が決まり、カードに出る', () => {
    const s = createInitialState(pack)
    const ok = applyOps(s, pack, [{ op: 'check', key: 'charms', level: '易' }], { roll: 10 })
    const ng = applyOps(s, pack, [{ op: 'check', key: 'charms', level: '易' }], { roll: 90 })
    expect(ok.changes).toContain('判定 呪文学（易）：成功')
    expect(ng.changes).toContain('判定 呪文学（易）：失敗')
    const bad = applyOps(s, pack, [{ op: 'check', key: 'reputation', level: '易' }], { roll: 10 })
    expect(bad.rejected).toHaveLength(1) // 判定に使えないステータス
  })

  it('判定結果表がAIに渡される', async () => {
    const ai = scripted()
    await runTurn(pack, createInitialState(pack), '', ai, 42)
    expect(ai.prompts[0]).toContain('このターンの判定結果表')
    expect(ai.prompts[0]).toContain('charms（呪文学 30）：易○ 普通× 難× 至難×')
  })
})

describe('固定イベント', () => {
  it('早送りしても予定の出来事の前で止まる', () => {
    const s = createInitialState(pack)
    s.firedEvents.kings_cross = 'canon'
    const r = applyOps(s, pack, [{ op: 'advance_time', days: 30 }])
    expect(r.state.date).toBe('1991-09-01')
    expect(pack.time.slots?.[r.state.slotIndex]).toBe('夜') // 組分け
  })

  it('時刻に達したイベントがAIに渡され、処理済みになる', async () => {
    const ai = scripted([{ op: 'advance_time', slots: 1 }])
    const r = await runTurn(pack, createInitialState(pack), '', ai, 50)
    expect(ai.prompts[0]).toContain('このターンに起きる出来事')
    expect(ai.prompts[0]).toContain('キングズ・クロス駅の9と3/4番線')
    expect(r.state.firedEvents.kings_cross).toBe('canon')
    expect(r.state.cards[0].events).toEqual(['キングズ・クロス駅の9と3/4番線'])
  })

  it('フラグで原作から分岐し、決まった効果は原作どおりのときだけ適用', () => {
    const s = createInitialState(pack)
    s.date = '1991-10-31'
    s.slotIndex = 4 // 夜
    for (const ev of pack.events) if (ev.id !== 'halloween_troll') s.firedEvents[ev.id] = 'canon'
    expect(dueEvents(pack, s)[0].mode).toBe('canon')
    s.flags.hermione_not_in_bathroom = true
    const d = dueEvents(pack, s)[0]
    expect(d.mode).toBe('diverged')
    expect(d.reason).toContain('前提が崩れている')
    expect(d.example).toContain('友情はこの夜には生まれない') // 参考の一例として渡す
  })

  it('条件のない出来事も、AIの記録したメモで分岐する', async () => {
    const s = createInitialState(pack)
    s.firedEvents.kings_cross = 'canon'
    s.slotIndex = 4 // 9/1 夜＝組分け
    s.flags['alt:sorting'] = 'プレイヤーが帽子より先に名前を呼ばれた'
    const ai = scripted()
    const r = await runTurn(pack, s, '様子を見る', ai, 50)
    expect(ai.prompts[0]).toContain('「組分けの儀式と新学期の宴」（原作から分岐）')
    expect(ai.prompts[0]).toContain('変化：プレイヤーが帽子より先に名前を呼ばれた')
    expect(r.state.firedEvents.sorting).toBe('diverged')
    expect(r.state.cards[0].events).toEqual(['組分けの儀式と新学期の宴（原作から分岐）'])
  })

  it('条件の判定', () => {
    const s = createInitialState(pack)
    expect(meets(s, { notFlags: { x: true } })).toBe(true)
    s.flags.x = true
    expect(meets(s, { notFlags: { x: true } })).toBe(false)
    expect(meets(s, { stats: [{ target: 'player', key: 'courage', min: 50 }] })).toBe(false)
    expect(meets(s, { stats: [{ target: 'hermione', key: 'trust', max: 10 }] })).toBe(true)
  })

  it('時刻の通し番号', () => {
    const s = createInitialState(pack)
    expect(nowOrdinal(pack, s)).toBe(ordinal(pack, '1991-09-01', 0))
    expect(ordinal(pack, '1991-09-02', 0) - ordinal(pack, '1991-09-01', 0)).toBe(6)
  })
})

describe('ステータスの影響', () => {
  it('条件を満たす間だけ影響がAIに渡る', async () => {
    const s = createInitialState(pack)
    expect(activeInfluences(pack, s)).toHaveLength(0)
    s.player.stats.rule_breaks = 4
    s.flags.house = 'スリザリン'
    const inf = activeInfluences(pack, s)
    expect(inf.some((t) => t.includes('フィルチ'))).toBe(true)
    expect(inf.some((t) => t.includes('スリザリン生'))).toBe(true)
    const ai = scripted()
    await runTurn(pack, s, '', ai, 50)
    expect(ai.prompts[0]).toContain('今効いている影響')
  })

  it('きっかけの出来事は一度だけ起き、効果がほかの人物に波及する', async () => {
    let s = createInitialState(pack)
    s.firedEvents.kings_cross = 'canon'
    s.player.stats.rule_breaks = 3
    expect(dueTriggers(pack, s).map((t) => t.id)).toEqual(['trigger:filch_watch'])
    s = (await runTurn(pack, s, '廊下を歩く', scripted(), 50)).state
    expect(s.characters.filch.stats.suspicion).toBe(40)
    expect(s.cards.at(-1)?.events).toEqual(['フィルチに目をつけられる'])
    expect(dueTriggers(pack, s)).toHaveLength(0)
  })

  it('人物との関係が先の原作の出来事を分岐させる', () => {
    const s = createInitialState(pack)
    s.characters.hermione.stats.affinity = 45
    s.characters.hermione.stats.trust = 45
    const t = dueTriggers(pack, s).find((x) => x.id === 'trigger:hermione_opens')!
    const r = applyOps(s, pack, t.effects)
    expect(r.state.flags['alt:halloween_charms']).toContain('友だちがいる')
  })
})
