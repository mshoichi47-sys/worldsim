import { WorldPackSchema, type WorldPack } from '../engine/types'

/**
 * 世界パックは src/worlds/<id>/pack.json に置くだけで自動で読み込まれる。
 * エンジン側に世界固有のコードを書かないこと。
 */
const files = import.meta.glob('./*/pack.json', { eager: true, import: 'default' })

export const WORLDS: WorldPack[] = Object.entries(files).map(([path, data]) => {
  const r = WorldPackSchema.safeParse(data)
  if (!r.success) throw new Error(`世界パック ${path} が不正です：${r.error.message}`)
  return r.data
})

export function getWorld(id: string): WorldPack | undefined {
  return WORLDS.find((w) => w.id === id)
}
