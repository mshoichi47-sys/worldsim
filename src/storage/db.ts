import Dexie, { type EntityTable } from 'dexie'
import type { GameState } from '../engine/types'

/** 世界ごとに1件。毎ターン自動で上書き保存する */
export interface SaveRecord {
  worldId: string
  state: GameState
  savedAt: number
}

const db = new Dexie('worldsim') as Dexie & { saves: EntityTable<SaveRecord, 'worldId'> }
db.version(1).stores({ saves: 'worldId, savedAt' })

export async function autoSave(state: GameState): Promise<void> {
  await db.saves.put({ worldId: state.worldId, state, savedAt: Date.now() })
}

export async function loadSave(worldId: string): Promise<GameState | undefined> {
  return (await db.saves.get(worldId))?.state
}

export async function listSaves(): Promise<SaveRecord[]> {
  return db.saves.toArray()
}

export async function deleteSave(worldId: string): Promise<void> {
  await db.saves.delete(worldId)
}

/* 端末間の移動用：書き出し・読み込み */

const EXPORT_FORMAT = 'worldsim-save'

export function exportSave(state: GameState): Blob {
  const body = JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), state })
  return new Blob([body], { type: 'application/json' })
}

export async function importSave(file: File): Promise<GameState> {
  const data = JSON.parse(await file.text()) as { format?: string; state?: GameState }
  if (data.format !== EXPORT_FORMAT || !data.state?.worldId || data.state.schemaVersion !== 1) {
    throw new Error('このアプリの書き出しファイルではありません。')
  }
  await autoSave(data.state)
  return data.state
}
