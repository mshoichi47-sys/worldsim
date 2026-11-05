import { useEffect, useRef } from 'react'
import type { GameState, WorldMap } from '../engine/types'

const SCALE = 0.85

/** 世界パックの座標から描く見取り図。現在地と、そこにいる人物を示す */
export function WorldMapView({ map, game }: { map: WorldMap; game: GameState }) {
  const here = game.player.location
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

  return (
    <div className="map-scroll" ref={boxRef}>
      <svg
        className="map"
        viewBox={`0 0 ${map.width} ${map.height}`}
        width={map.width * SCALE}
        role="img"
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
          const people = peopleAt(p.name)
          const isHere = p.name === here
          return (
            <g key={p.name}>
              {isHere && <circle cx={p.x} cy={p.y} r={12} className="map-here-ring" />}
              <circle cx={p.x} cy={p.y} r={isHere ? 6 : 4} className={isHere ? 'map-dot here' : 'map-dot'} />
              <text x={p.x} y={p.y + 20} textAnchor="middle" className={isHere ? 'map-label here' : 'map-label'}>
                {p.name}
              </text>
              {people.length > 0 && (
                <text x={p.x + 9} y={p.y - 7} className="map-count">
                  {people.length}人
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
