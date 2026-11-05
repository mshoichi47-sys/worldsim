import { beforeEach, describe, expect, it } from 'vitest'
import { mockProvider } from '../ai/mock'
import type { AIProvider } from '../ai/provider'
import { applyOps } from './ops'
import { addDays, createInitialState } from './state'
import { runTurn } from './turn'
import { WorldPackSchema } from './types'
import samplePack from '../worlds/sample/pack.json'

const pack = WorldPackSchema.parse(samplePack)

// localStorage の代わり（使用量カウント用）
beforeEach(() => {
  const mem = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage
})

describe('applyOps', () => {
  it('範囲外の値は丸め、存在しない対象は捨てる', () => {
    const s = createInitialState(pack)
    const r = applyOps(s, pack, [
      { op: 'adjust_stat', target: 'world', key: 'storm', delta: 999 },
      { op: 'adjust_stat', target: 'ghost', key: 'affinity', delta: 5 },
      { op: 'move', target: 'player', location: '月面' },
      { op: 'remove_item', item: '持っていない物' },
    ])
    expect(r.state.worldStats.storm).toBe(20 + 20) // 1回の上限は範囲の20%
    expect(r.rejected).toHaveLength(3)
    expect(s.worldStats.storm).toBe(20) // 元の状態は変わらない
  })

  it('死亡した人物は操作できない', () => {
    const s = createInitialState(pack)
    const r1 = applyOps(s, pack, [{ op: 'set_status', target: 'genzo', status: 'dead' }])
    const r2 = applyOps(r1.state, pack, [
      { op: 'adjust_stat', target: 'genzo', key: 'affinity', delta: 5 },
      { op: 'set_status', target: 'genzo', status: 'active' },
    ])
    expect(r2.rejected).toHaveLength(2)
    expect(r2.state.characters.genzo.status).toBe('dead')
  })

  it('時間帯が一周すると日付が進む', () => {
    const s = createInitialState(pack)
    const r = applyOps(s, pack, [{ op: 'advance_time', slots: 5 }])
    expect(r.state.date).toBe(addDays(pack.time.start, 1))
    expect(r.state.slotIndex).toBe(1)
  })
})

describe('runTurn', () => {
  it('10ターン続けても状態が矛盾しない（フェーズ1の関門）', async () => {
    const ai = mockProvider()
    let state = createInitialState(pack)
    state = (await runTurn(pack, state, '', ai)).state // 導入
    for (let i = 0; i < 10; i++) state = (await runTurn(pack, state, `行動${i}`, ai)).state

    expect(state.turn).toBe(11)
    expect(state.cards).toHaveLength(11)
    expect(state.cards.map((c) => c.turn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(state.summarizedThroughTurn).toBe(10)
    expect(state.summary).not.toBe('')
    for (const d of pack.worldStats) {
      expect(state.worldStats[d.key]).toBeGreaterThanOrEqual(d.min)
      expect(state.worldStats[d.key]).toBeLessThanOrEqual(d.max)
    }
    for (const c of Object.values(state.characters)) {
      for (const d of pack.characterStats) {
        expect(c.stats[d.key]).toBeGreaterThanOrEqual(d.min)
        expect(c.stats[d.key]).toBeLessThanOrEqual(d.max)
      }
    }
    // 時間は後戻りしない
    const dates = state.cards.map((c) => c.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('JSONが崩れたら1回だけ再試行し、物語が取れれば壊れた操作だけ捨てる', async () => {
    let calls = 0
    const flaky: AIProvider = {
      label: 'flaky',
      async generate() {
        calls++
        if (calls === 1) return '{ 壊れたJSON'
        return JSON.stringify({ narrative: '霧が晴れた。', suggestions: ['a'], ops: [{ op: 'fly' }, { op: 'advance_time', slots: 1 }] })
      },
    }
    const r = await runTurn(pack, createInitialState(pack), '', flaky)
    expect(calls).toBe(2)
    expect(r.state.cards[0].narrative).toBe('霧が晴れた。')
    expect(r.state.slotIndex).toBe(1)
    expect(r.rejected).toHaveLength(1)
  })

  it('2回とも崩れたら状態を変えずにエラー', async () => {
    const bad: AIProvider = { label: 'bad', generate: async () => 'not json' }
    const s = createInitialState(pack)
    await expect(runTurn(pack, s, '', bad)).rejects.toThrow('読み取れません')
    expect(s.turn).toBe(0)
  })
})
