import { checkableStats, type DueEvent } from './rules'
import { formatDate, formatWhen } from './state'
import type { GameState, StatDef, StoryCard, WorldEvent, WorldPack } from './types'
import { OP_NAMES } from './types'

export const RECENT_TURNS = 5
export const SUMMARY_EVERY = 10

const statLine = (d: StatDef) => `${d.key}（${d.label}、${d.min}〜${d.max}）`

/** 毎ターン同じになる部分（世界設定・ルール）。文脈キャッシュの対象 */
export function buildSystemPrompt(pack: WorldPack): string {
  const slots = pack.time.slots?.length ? `時間帯：${pack.time.slots.join('→')}（1日の中で順に進む）` : '時間帯なし（日単位）'
  return `あなたはテキストシミュレーションゲーム「${pack.title}」のゲームマスターです。
日本語で、プレイヤーの行動に対して世界と人物がどう反応したかを物語として描写します。

# 世界観
${pack.world}

# プレイヤーの立場
${pack.playerRole}

# 世界のルール
${pack.rules || '（特になし）'}

# 描写方針
${pack.style || '（特になし）'}

# 時間
1ターンの長さ：${pack.time.turnHint}
${slots}

# 状態について（最重要）
- 数値・所在・生死などの状態は、ゲームのプログラムが管理しています。あなたは状態を直接書き換えず、「ops」で変更を提案するだけです。
- 提案はプログラムが検証し、範囲外や存在しない対象は捨てられます。1回の変化は小さめにしてください。
- 渡された「現在の状態」と矛盾する描写をしてはいけません（死亡した人物は登場させない、持っていない物は使えない、など）。
- 描写した結果に見合う ops を必ず出してください。時間が進んだなら advance_time を出してください。

# 使える ops（op の値は ${OP_NAMES.join(' / ')}）
- adjust_stat：target（"world" / "player" / 人物ID）、key（ステータスのキー）、delta（増減量）
- set_flag：key、value（文字列または真偽値）
- move：target（"player" または人物ID）、location（場所名${pack.locations.length ? '。下の場所一覧から選ぶ' : ''}）
- set_status：target（人物ID）、status（active / absent / dead）
- add_memory：target（人物ID）、text（その人物がこのターンで覚えたこと。短く）
- add_item / remove_item：item（プレイヤーの持ち物）
- log_event：text（年表に残すべき出来事。重要なものだけ短く）
- advance_time：days（進めた日数）${pack.time.slots?.length ? '、slots（進めた時間帯の数）' : ''}。予定の出来事の手前で自動的に止まる
- check：key（判定に使うステータスのキー）、level（易 / 普通 / 難 / 至難）、text（何を試みたか）
- plot_note：text（今後の伏線や展開の予定。プレイヤーには見せない自分用のメモ）
${checkableStats(pack).length ? `
# 判定（最重要）
- プレイヤーの行動の成否が能力に左右されるとき（呪文、試験、説得、隠密、運動など）は、プログラムが振ったサイコロによる「判定結果表」に必ず従ってください。
- 表は「ステータス：難度ごとの○（成功）×（失敗）」です。行動の難しさに合う難度を選び、その結果どおりに描写し、同じ内容の check を ops に出してください。
- 表を無視して成功・失敗を決めてはいけません。能力が関係しない行動では判定は不要です。
` : ''}${pack.events.length ? `
# 予定の出来事（原作・史実）
- 「このターンに起きる出来事」が渡されたら、プレイヤーの行動と自然につなげて必ず描写してください。プレイヤーがその場にいなければ、噂や知らせとして伝わる形でもかまいません。
- 「これから起きる出来事」は先の予定です。伏線として匂わせてもよいですが、先取りして起こしてはいけません。
- プレイヤーの行動が予定の出来事の前提を変えたら、各出来事の「分岐の目安」に書かれたフラグを set_flag で立ててください。後の展開はプログラムがそのフラグで決めます。
` : ''}
# ステータス一覧
世界：${pack.worldStats.map(statLine).join('、') || 'なし'}
プレイヤー：${pack.playerStats.map(statLine).join('、') || 'なし'}
人物ごと：${pack.characterStats.map(statLine).join('、') || 'なし'}
${pack.locations.length ? `\n# 場所一覧\n${pack.locations.join('、')}\n` : ''}
# 人物カード
${pack.characters.map((c) => `- ${c.id}：${c.name}。${c.description}`).join('\n') || '（なし）'}

# 出力
JSONで返します。
- narrative：このターンの物語本文（400〜800字程度。地の文と会話）
- suggestions：プレイヤーが次に取れる行動の候補を3つ（それぞれ20字程度）
- ops：状態変更の提案の配列（なければ空配列）`
}

function compactState(pack: WorldPack, state: GameState) {
  const statsOf = (defs: StatDef[], values: Record<string, number>) =>
    Object.fromEntries(defs.map((d) => [d.key, values[d.key]]))
  return {
    いつ: formatWhen(pack, state),
    ターン: state.turn,
    世界: statsOf(pack.worldStats, state.worldStats),
    プレイヤー: {
      名前: state.player.name,
      場所: state.player.location ?? null,
      ステータス: statsOf(pack.playerStats, state.player.stats),
      持ち物: state.player.inventory,
    },
    人物: Object.values(state.characters).map((c) => ({
      id: c.id,
      名前: c.name,
      状態: c.status,
      場所: c.location ?? null,
      ステータス: statsOf(pack.characterStats, c.stats),
      覚えていること: c.memories.slice(-5),
    })),
    フラグ: state.flags,
    最近の出来事: state.events.slice(-10).map((e) => `${e.date} ${e.text}`),
  }
}

const cardText = (c: StoryCard) => `【ターン${c.turn}／${c.date}${c.slot ? '・' + c.slot : ''}】\nプレイヤーの行動：${c.action}\n${c.narrative}`

export interface TurnExtras {
  due: DueEvent[]
  upcoming: WorldEvent[]
  /** 判定結果表（判定に使えるステータスがない世界では空） */
  checkTable: string
}

const eventLine = (e: WorldEvent) =>
  `- ${formatDate(e.date)}${e.slot ? '・' + e.slot : ''}「${e.title}」：${e.canon}${e.branchHint ? `\n  分岐の目安：${e.branchHint}` : ''}`

export function buildTurnPrompt(
  pack: WorldPack,
  state: GameState,
  action: string,
  isOpening: boolean,
  extras: TurnExtras = { due: [], upcoming: [], checkTable: '' },
): string {
  const recent = state.cards.slice(-RECENT_TURNS).map(cardText).join('\n\n')
  const due = extras.due.filter((d) => d.mode !== 'skipped')
  return `# 現在の状態
${JSON.stringify(compactState(pack, state), null, 1)}

# これまでの要約
${state.summary || '（まだない）'}

# 隠し筋書き（プレイヤーには見せない。展開の参考にする）
${state.hiddenPlot || '（なし）'}
${state.plotNotes.length ? `\n自分のメモ：\n${state.plotNotes.map((n) => `- ${n}`).join('\n')}\n` : ''}${
    due.length
      ? `\n# このターンに起きる出来事（必ず描写する）\n${due
          .map((d) => `- 「${d.event.title}」${d.mode === 'alt' ? '（原作から分岐した形）' : ''}：${d.text}${d.event.branchHint ? `\n  分岐の目安：${d.event.branchHint}` : ''}`)
          .join('\n')}\n`
      : ''
  }${extras.upcoming.length ? `\n# これから起きる出来事（先取りしない）\n${extras.upcoming.map(eventLine).join('\n')}\n` : ''}${
    extras.checkTable ? `\n# このターンの判定結果表\n${extras.checkTable}\n` : ''
  }
# 直近の展開
${recent || '（まだない）'}

# ${isOpening ? 'ゲーム開始' : 'プレイヤーの行動'}
${isOpening ? pack.opening : action}`
}

export function buildSummaryPrompt(previous: string, cards: StoryCard[]): string {
  return `次の「これまでの要約」と「新しい展開」を合わせて、物語の要約を作り直してください。
後で物語を続けるために必要な事実（誰が何をしたか、関係の変化、約束、未解決の謎、重要な出来事の日付）を優先し、800字以内にまとめます。
JSONで { "summary": "..." } の形で返してください。

# これまでの要約
${previous || '（まだない）'}

# 新しい展開
${cards.map(cardText).join('\n\n')}`
}

/** Gemini の構造化出力に渡す JSON Schema */
export const TURN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: [...OP_NAMES] },
          target: { type: 'string' },
          key: { type: 'string' },
          delta: { type: 'number' },
          value: { type: 'string' },
          location: { type: 'string' },
          status: { type: 'string', enum: ['active', 'absent', 'dead'] },
          text: { type: 'string' },
          item: { type: 'string' },
          days: { type: 'integer' },
          slots: { type: 'integer' },
          level: { type: 'string', enum: ['易', '普通', '難', '至難'] },
        },
        required: ['op'],
      },
    },
  },
  required: ['narrative', 'suggestions', 'ops'],
} as const

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
} as const
