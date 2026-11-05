import type { GameState, StatDef, WorldPack } from '../engine/types'
import { formatDate, formatWhen } from '../engine/state'
import { exportSave } from '../storage/db'

function Meter({ def, value }: { def: StatDef; value: number }) {
  const pct = ((value - def.min) / (def.max - def.min)) * 100
  return (
    <div className="meter">
      <span>{def.label}</span>
      <span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
      <span className="num">{value}</span>
    </div>
  )
}

export function StatusPanel({ pack, game }: { pack: WorldPack; game: GameState }) {
  const download = () => {
    const url = URL.createObjectURL(exportSave(game))
    const a = document.createElement('a')
    a.href = url
    a.download = `worldsim-${game.worldId}-turn${game.turn}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const people = Object.values(game.characters)

  return (
    <div className="panel">
      <h2>{formatWhen(pack, game)}</h2>
      {pack.worldStats.map((d) => <Meter key={d.key} def={d} value={game.worldStats[d.key]} />)}

      <h2>{game.player.name}{game.player.location ? `（${game.player.location}）` : ''}</h2>
      {pack.playerStats.map((d) => <Meter key={d.key} def={d} value={game.player.stats[d.key]} />)}
      {game.player.inventory.length > 0 && (
        <div className="tags" aria-label="持ち物">
          {game.player.inventory.map((it, i) => <span key={i}>{it}</span>)}
        </div>
      )}

      {people.length > 0 && <h2>人物</h2>}
      {people.map((c) => (
        <div className={`person ${c.status}`} key={c.id}>
          <div className="name">{c.name}</div>
          <div className="where">
            {c.status === 'dead' ? '死亡' : c.status === 'absent' ? '不在' : c.location ?? '所在不明'}
          </div>
          {c.status !== 'dead' && pack.characterStats.map((d) => <Meter key={d.key} def={d} value={c.stats[d.key]} />)}
        </div>
      ))}

      {game.events.length > 0 && (
        <>
          <h2>年表</h2>
          <ul className="timeline">
            {[...game.events].reverse().map((e, i) => (
              <li key={i}><time>{formatDate(e.date)}</time>{e.text}</li>
            ))}
          </ul>
        </>
      )}

      <h2>進行</h2>
      <p className="usage">毎ターン自動で保存しています。別の端末で続けるときは書き出したファイルを読み込んでください。</p>
      <button className="btn" onClick={download}>進行を書き出す</button>
    </div>
  )
}
