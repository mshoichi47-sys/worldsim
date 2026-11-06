import type { AIProvider } from './provider'
import { recordUsage } from './usage'

/**
 * AIを使わないテスト用接続。無料枠を使わずに画面とエンジンを確かめるためのもの。
 * 決まった形の応答を返し、ステータスを少し動かして時間を進める。
 */
export function mockProvider(): AIProvider {
  return {
    label: 'テスト（AIなし）',
    async generate(req) {
      recordUsage('mock')
      await new Promise((r) => setTimeout(r, 150))
      if (req.kind === 'summary') {
        return JSON.stringify({ summary: `（テスト要約）ターン${req.meta?.state.turn ?? '?'}までの出来事。` })
      }
      const meta = req.meta
      if (!meta) return JSON.stringify({ narrative: '（テスト）何かが起きた。', check: { key: '', level: 'なし' }, suggestions: [], ops: [] })
      const { pack, state, action } = meta
      const n = state.turn + 1
      const ws = pack.worldStats[n % Math.max(1, pack.worldStats.length)]
      const ch = Object.values(state.characters).find((c) => c.status === 'active')
      const cs = pack.characterStats[0]
      const checkable = pack.playerStats.filter((d) => d.checkable)
      const pick = (i: number) => checkable[(n + i) % Math.max(1, checkable.length)]
      const path = (i: number) => pack.paths[(n + i) % Math.max(1, pack.paths.length)]?.id ?? ''
      const ops: object[] = [{ op: 'advance_time', ...(pack.time.slots?.length ? { slots: 1 } : { days: 7 }) }]
      if (ws) ops.push({ op: 'adjust_stat', target: 'world', key: ws.key, delta: n % 2 ? 3 : -2 })
      if (ch && cs) {
        ops.push({ op: 'adjust_stat', target: ch.id, key: cs.key, delta: 2 })
        ops.push({ op: 'add_memory', target: ch.id, text: `ターン${n}：「${action.slice(0, 20)}」を見た` })
      }
      if (n % 5 === 0) ops.push({ op: 'log_event', text: `ターン${n}の節目` })
      // わざと不正な操作も混ぜ、コード側で捨てられることを確かめる
      ops.push({ op: 'adjust_stat', target: 'nobody', key: 'x', delta: 999 })
      return JSON.stringify({
        narrative: `（テスト応答 ターン${n}）\nあなたは「${action}」。${ch ? `${ch.name}がそれを見ていた。` : ''}時間が少し過ぎた。`,
        check: checkable.length && n % 3 === 0 ? { key: pick(0).key, level: '普通' } : { key: '', level: 'なし' },
        suggestions: [
          { text: '周りを見回す', key: '', level: 'なし', path: path(0) },
          { text: checkable.length ? `${pick(1).label}を試す` : '誰かに話しかける', key: checkable.length ? pick(1).key : '', level: checkable.length ? '普通' : 'なし', path: path(1) },
          { text: checkable.length ? `${pick(2).label}で難題に挑む` : '先へ進む', key: checkable.length ? pick(2).key : '', level: checkable.length ? '難' : 'なし', path: path(2) },
        ],
        ops,
        next_pace: n % 4 === 0 ? '場面' : '日々',
      })
    },
  }
}
