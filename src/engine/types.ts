import { z } from 'zod'

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
  'check',
  'plot_note',
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
  level: z.enum(['易', '普通', '難', '至難']).optional(),
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
  /** 判定（サイコロ）に使えるステータスか */
  checkable: z.boolean().default(false),
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

/** 状態に対する条件。書いた項目はすべて満たす必要がある（AND） */
export const ConditionSchema = z.object({
  /** このフラグがこの値であること */
  flags: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  /** このフラグがこの値でないこと（未設定も「でない」に含む） */
  notFlags: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  /** 数値の範囲 */
  stats: z
    .array(
      z.object({
        target: z.string(),
        key: z.string(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .optional(),
  /** この人物が死亡していないこと */
  alive: z.array(z.string()).optional(),
})
export type Condition = z.infer<typeof ConditionSchema>

/** 日付つきの固定イベント（原作・史実の出来事） */
export const WorldEventSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 時間帯（slotsのどれか）。省略時はその日の最初 */
  slot: z.string().optional(),
  title: z.string(),
  /** 原作どおりなら何が起きるか（AIに渡す） */
  canon: z.string(),
  /** プレイヤーの介入でどう変わりうるか、どのフラグを立てるか（AIに渡す） */
  branchHint: z.string().optional(),
  /** 原作どおり起きる条件。満たさなければ「分岐」として扱い、中身はAIが決める */
  requires: ConditionSchema.optional(),
  /** 分岐したときの展開の参考例（AIはこれに縛られない） */
  alt: z.string().optional(),
  /** 起きたときに自動で適用する操作 */
  effects: z.array(RawOpSchema).default([]),
  /** 予定としてプレイヤーに見せるか（ネタばれになるものは false） */
  public: z.boolean().default(false),
})
export type WorldEvent = z.infer<typeof WorldEventSchema>

/** 条件を満たしている間ずっと効く影響（AIに渡す） */
export const InfluenceSchema = z.object({
  id: z.string(),
  when: ConditionSchema,
  text: z.string(),
})
export type Influence = z.infer<typeof InfluenceSchema>

/** 条件を満たしたときに一度だけ起きる出来事（日付なし） */
export const TriggerSchema = z.object({
  id: z.string(),
  when: ConditionSchema,
  title: z.string(),
  text: z.string(),
  effects: z.array(RawOpSchema).default([]),
})
export type Trigger = z.infer<typeof TriggerSchema>

export const MapSchema = z.object({
  width: z.number(),
  height: z.number(),
  places: z.array(z.object({ name: z.string(), x: z.number(), y: z.number(), group: z.string().optional() })),
  /** 場所どうしのつながり（線） */
  links: z.array(z.tuple([z.string(), z.string()])).default([]),
})
export type WorldMap = z.infer<typeof MapSchema>

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
  events: z.array(WorldEventSchema).default([]),
  influences: z.array(InfluenceSchema).default([]),
  triggers: z.array(TriggerSchema).default([]),
  /** 開始時の隠し筋書き（プレイヤーに見せない真相など） */
  hiddenPlot: z.string().default(''),
  /** 開始前にプレイヤーの名前を聞くか */
  askName: z.boolean().default(false),
  map: MapSchema.optional(),
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
  /** このターンに起きた固定イベントの題名 */
  events?: string[]
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
  /** 固定イベントの処理済み記録 */
  firedEvents: Record<string, 'canon' | 'diverged' | 'alt' | 'skipped'>
  /** 出来事の年表 */
  events: { turn: number; date: string; text: string }[]
  /** 10ターンごとに更新する要約 */
  summary: string
  summarizedThroughTurn: number
  /** プレイヤーに見せない伏線・今後の展開 */
  hiddenPlot: string
  /** AIが残す伏線メモ（プレイヤーに見せない） */
  plotNotes: string[]
  suggestions: string[]
  cards: StoryCard[]
  updatedAt: number
}

