import { Fragment } from 'react'
import { activeInfluences, upcomingEvents } from '../engine/rules'
import type { GameState, StatDef, WorldPack } from '../engine/types'
import { formatDate, formatWhen } from '../engine/state'
import { exportSave } from '../storage/db'
import { WorldMapView } from './WorldMapView'

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

/** グループ（科目・資質など）ごとに見出しを付けて並べる */
function Meters({ defs, values }: { defs: StatDef[]; values: Record<string, number> }) {
  return (
    <>
      {defs.map((d, i) => (
        <Fragment key={d.key}>
          {d.group && d.group !== defs[i - 1]?.group && <h3 className="group">{d.group}</h3>}
          <Meter def={d} value={values[d.key]} />
        </Fragment>
      ))}
    </>
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
  const schedule = upcomingEvents(pack, game, 5, true)
  const house = typeof game.flags.house === 'string' ? game.flags.house : undefined
  const influences = activeInfluences(pack, game)

  return (
    <div className="panel">
      <h2>{formatWhen(pack, game)}</h2>
      <Meters defs={pack.worldStats} values={game.worldStats} />

      {schedule.length > 0 && (
        <>
          <h2>これからの予定</h2>
          <ul className="timeline">
            {schedule.map((e) => (
              <li key={e.id}><time>{formatDate(e.date)}{e.slot ? `・${e.slot}` : ''}</time>{e.title}</li>
            ))}
          </ul>
        </>
      )}

      <h2>
        {game.player.name}
        {house ? `（${house}）` : ''}
      </h2>
      {game.player.location && <p className="where-now">いる場所：{game.player.location}</p>}
      {pack.map && <WorldMapView map={pack.map} game={game} />}
      <Meters defs={pack.playerStats} values={game.player.stats} />
      {game.player.inventory.length > 0 && (
        <div className="tags" aria-label="持ち物">
          {game.player.inventory.map((it, i) => <span key={i}>{it}</span>)}
        </div>
      )}

      {influences.length > 0 && (
        <>
          <h2>周りへの影響</h2>
          <ul className="timeline">
            {influences.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
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
