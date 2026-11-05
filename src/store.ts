import { create } from 'zustand'
import { AIError } from './ai/provider'
import { createInitialState } from './engine/state'
import { runTurn } from './engine/turn'
import type { GameState, WorldPack } from './engine/types'
import { loadSettings, makeProvider, saveSettings, type Settings } from './settings'
import { autoSave, deleteSave, importSave, listSaves, loadSave, type SaveRecord } from './storage/db'
import { getWorld } from './worlds'

interface AppState {
  screen: 'home' | 'game'
  pack?: WorldPack
  game?: GameState
  busy: boolean
  error?: string
  warning?: string
  settings: Settings
  saves: SaveRecord[]

  refreshSaves: () => Promise<void>
  startNew: (worldId: string) => Promise<void>
  resume: (worldId: string) => Promise<void>
  act: (action: string) => Promise<void>
  goHome: () => void
  updateSettings: (patch: Partial<Settings>) => void
  importFile: (file: File) => Promise<void>
  removeSave: (worldId: string) => Promise<void>
  clearMessages: () => void
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'home',
  busy: false,
  settings: loadSettings(),
  saves: [],

  refreshSaves: async () => set({ saves: await listSaves() }),

  startNew: async (worldId) => {
    const pack = getWorld(worldId)
    if (!pack) return
    const game = createInitialState(pack)
    await autoSave(game)
    set({ screen: 'game', pack, game, error: undefined, warning: undefined })
    await get().act('')
  },

  resume: async (worldId) => {
    const pack = getWorld(worldId)
    const game = await loadSave(worldId)
    if (!pack || !game) return
    set({ screen: 'game', pack, game, error: undefined, warning: undefined })
    // 導入場面の生成に失敗したまま終わっていた場合は、もう一度導入から
    if (game.cards.length === 0) await get().act('')
  },

  act: async (action) => {
    const { pack, game, busy, settings } = get()
    if (!pack || !game || busy) return
    set({ busy: true, error: undefined, warning: undefined })
    try {
      const r = await runTurn(pack, game, action, makeProvider(settings))
      await autoSave(r.state)
      if (r.rejected.length) console.info('捨てた操作', r.rejected)
      set({ game: r.state, warning: r.warning })
    } catch (e) {
      set({ error: e instanceof AIError ? e.message : `エラー：${(e as Error).message}` })
    } finally {
      set({ busy: false })
    }
  },

  goHome: () => {
    set({ screen: 'home', error: undefined, warning: undefined })
    void get().refreshSaves()
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },

  importFile: async (file) => {
    try {
      await importSave(file)
      await get().refreshSaves()
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  removeSave: async (worldId) => {
    await deleteSave(worldId)
    await get().refreshSaves()
  },

  clearMessages: () => set({ error: undefined, warning: undefined }),
}))
