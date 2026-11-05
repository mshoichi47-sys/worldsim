import { z } from 'zod'

/* ========== 世界パック（データ） ========== */

export const StatDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  initial: z.number().optional(),
  /** 1回の操作で動かせる最大幅。省略時は範囲の20% */
  maxDelta: z.number().optional(),
  group: z.string().optional(),
})
export type StatDef = z.infer<typeof StatDefSchema>

export const CharacterDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 人物カード：性格・口調・立ち位置など（AIに渡す） */
  description: z.string(),
  location: z.string().optional(),
  stats: z.record(z.string(), z.number()).default({}),
})
export type CharacterDef = z.infer<typeof CharacterDefSchema>

export const WorldPackSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().default(''),
  /** プレイヤーの立場（AIに渡す） */
  playerRole: z.string(),
  /** 世界観の文書（AIに渡す） */
  world: z.string(),
  /** 世界固有のルール（AIに渡す） */
  rules: z.string().default(''),
  /** 描写方針（AIに渡す） */
  style: z.string().default(''),
  time: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** 1日の中の時間帯（例：朝・授業・放課後・夜）。なければ日単位 */
    slots: z.array(z.string()).optional(),
    /** 1ターンの長さの目安（AIに渡す） */
    turnHint: z.string(),
  }),
  worldStats: z.array(StatDefSchema).default([]),
  playerStats: z.array(StatDefSchema).default([]),
  characterStats: z.array(StatDefSchema).default([]),
  locations: z.array(z.string()).default([]),
  player: z.object({
    name: z.string(),
    location: z.string().optional(),
    inventory: z.array(z.string()).default([]),
  }),
  characters: z.array(CharacterDefSchema).default([]),
  /** ゲーム開始時の指示（導入場面の描写方針） */
  opening: z.string().default('導入場面を描写してください。'),
  theme: z.enum(['default', 'parchment', 'newspaper']).default('default'),
})
export type WorldPack = z.infer<typeof WorldPackSchema>

/* ========== ゲーム状態（コードが正） ========== */

export type CharacterStatus = 'active' | 'absent' | 'dead'

export interface CharacterState {
  id: string
  name: string
  location?: string
  status: CharacterStatus
  stats: Record<string, number>
  /** そのキャラが覚えていること */
  memories: string[]
}

export interface StoryCard {
  turn: number
  date: string
  slot?: string
  action: string
  narrative: string
  /** 適用された変化（人が読める形） */
  changes: string[]
}

export interface GameState {
  schemaVersion: 1
  worldId: string
  turn: number
  date: string
  slotIndex: number
  worldStats: Record<string, number>
  player: {
    name: string
    location?: string
    stats: Record<string, number>
    inventory: string[]
  }
  characters: Record<string, CharacterState>
  flags: Record<string, string | boolean>
  /** 出来事の年表 */
  events: { turn: number; date: string; text: string }[]
  /** 10ターンごとに更新する要約 */
  summary: string
  summarizedThroughTurn: number
  /** プレイヤーに見せない伏線・今後の展開 */
  hiddenPlot: string
  suggestions: string[]
  cards: StoryCard[]
  updatedAt: number
}

/* ========== AIの応答 ========== */

export const OP_NAMES = [
  'adjust_stat',
  'set_flag',
  'move',
  'set_status',
  'add_memory',
  'add_item',
  'remove_item',
  'log_event',
  'advance_time',
] as const
export type OpName = (typeof OP_NAMES)[number]

/** 構造化出力に合わせ、操作はフラットな1種類のオブジェクトで受ける */
export const RawOpSchema = z.object({
  op: z.enum(OP_NAMES),
  target: z.string().optional(),
  key: z.string().optional(),
  delta: z.number().optional(),
  value: z.union([z.string(), z.boolean()]).optional(),
  location: z.string().optional(),
  status: z.enum(['active', 'absent', 'dead']).optional(),
  text: z.string().optional(),
  item: z.string().optional(),
  days: z.number().optional(),
  slots: z.number().optional(),
})
export type RawOp = z.infer<typeof RawOpSchema>

export const TurnResponseSchema = z.object({
  narrative: z.string().min(1),
  suggestions: z.array(z.string()).default([]),
  ops: z.array(RawOpSchema).default([]),
})
export type TurnResponse = z.infer<typeof TurnResponseSchema>

export const SummaryResponseSchema = z.object({
  summary: z.string().min(1),
})
