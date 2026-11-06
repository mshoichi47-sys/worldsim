import { useEffect, useRef, useState } from 'react'
import type { GameState, WorldMap } from '../engine/types'

const SCALE = 0.85

/**
 * 世界パックの座標から描く見取り図。
 * 場所を押すと、そこにいる人物と「ここへ行く」「話しかける」が出る。
 */
export function WorldMapView({
  map,
  game,
  onAction,
}: {
  map: WorldMap
  game: GameState
  /** 行動を送る（処理中は undefined） */
  onAction?: (text: string) => void
}) {
  const here = game.player.location
  // 選んだ場所は、そのときの現在地とセットで覚える。現在地が変わったら選択は現在地に戻る
  const [pick, setPick] = useState<{ place: string; at?: string }>()
  const selected = pick && pick.at === here ? pick.place : here
  const setSelected = (place: string) => setPick({ place, at: here })
  const boxRef = useRef<HTMLDivElement>(null)
  const herePlace = map.places.find((p) => p.name === here)

  // 画面より地図が広いときは、現在地が真ん中に来るように横にずらす
  useEffect(() => {
    const box = boxRef.current
    if (box && herePlace) box.scrollLeft = herePlace.x * SCALE - box.clientWidth / 2
  }, [herePlace])

  const peopleAt = (place: string) =>
    Object.values(game.characters).filter((c) => c.status === 'active' && c.location === place)

  // 区分（塔・地下など）ごとの縦の範囲
  const groups = new Map<string, { min: number; max: number }>()
  for (const p of map.places) {
    if (!p.group) continue
    const g = groups.get(p.group)
    groups.set(p.group, g ? { min: Math.min(g.min, p.y), max: Math.max(g.max, p.y) } : { min: p.y, max: p.y })
  }

  const people = selected ? peopleAt(selected) : []

  return (
    <div className="map-wrap">
      <div className="map-scroll" ref={boxRef}>
        <svg
          className="map"
          viewBox={`0 0 ${map.width} ${map.height}`}
          width={map.width * SCALE}
          role="group"
          aria-label={`見取り図。現在地：${here ?? '不明'}`}
        >
          {[...groups.entries()].map(([name, g], i) => (
            <g key={name}>
              <rect
                x={4}
                y={g.min - 32}
                width={map.width - 8}
                height={g.max - g.min + 60}
                rx={8}
                className={i % 2 ? 'map-band alt' : 'map-band'}
              />
              <text x={14} y={g.min - 14} className="map-group">{name}</text>
            </g>
          ))}
          {map.places.map((p) => {
            const n = peopleAt(p.name).length
            const isHere = p.name === here
            const isSel = p.name === selected
            return (
              <g
                key={p.name}
                className={`map-place${isSel ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${p.name}${isHere ? '（現在地）' : ''}${n ? `、${n}人` : ''}`}
                onClick={() => setSelected(p.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(p.name)
                  }
                }}
              >
                {/* 押しやすいように、見えない広めの当たり判定 */}
                <rect x={p.x - 62} y={p.y - 18} width={124} height={44} className="map-hit" />
                {isSel && <rect x={p.x - 60} y={p.y - 16} width={120} height={40} rx={8} className="map-sel" />}
                {isHere && <circle cx={p.x} cy={p.y} r={12} className="map-here-ring" />}
                <circle cx={p.x} cy={p.y} r={isHere ? 6 : 4} className={isHere ? 'map-dot here' : 'map-dot'} />
                <text x={p.x} y={p.y + 20} textAnchor="middle" className={isHere ? 'map-label here' : 'map-label'}>
                  {p.name}
                </text>
                {n > 0 && (
                  <text x={p.x + 9} y={p.y - 7} className="map-count">
                    {n}人
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {selected && (
        <div className="place-card">
          <div className="place-head">
            <b>{selected}</b>
            {selected === here ? (
              <span className="place-here">いまここにいる</span>
            ) : (
              <button className="btn" disabled={!onAction} onClick={() => onAction?.(`${selected}へ行く`)}>
                ここへ行く
              </button>
            )}
          </div>
          {people.length === 0 ? (
            <p className="place-empty">いまは誰もいないようだ。</p>
          ) : (
            <ul className="place-people">
              {people.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <button
                    className="btn"
                    disabled={!onAction}
                    onClick={() =>
                      onAction?.(selected === here ? `${c.name}に話しかける` : `${selected}へ行って${c.name}に話しかける`)
                    }
                  >
                    話しかける
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
