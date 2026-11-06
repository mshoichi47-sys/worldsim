import { altFlag, checkLine, checkableStats, type DueEvent } from './rules'
import { formatDate, formatWhen } from './state'
import type { CheckResult, GameState, StatDef, StoryCard, WorldEvent, WorldPack } from './types'
import { LEVELS, OP_NAMES } from './types'

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

# 使える ops
- adjust_stat：target（"world" / "player" / 人物ID）、key（ステータスのキー）、delta（増減量）
- set_flag：key、value（文字列または真偽値）
- move：target（"player" または人物ID）、location（場所名${pack.locations.length ? '。下の場所一覧から選ぶ' : ''}）
- set_status：target（人物ID）、status（active / absent / dead）
- add_memory：target（人物ID）、text（その人物がこのターンで覚えたこと。短く）
- add_item / remove_item：item（プレイヤーの持ち物）
- log_event：text（年表に残すべき出来事。重要なものだけ短く。日付は書かない。予定の出来事そのものはプログラムが記録するので書かない）
- advance_time：days（進めた日数）${pack.time.slots?.length ? '、slots（進めた時間帯の数）' : ''}。予定の出来事の手前で自動的に止まる
- plot_note：text（今後の伏線や展開の予定。プレイヤーには見せない自分用のメモ）
${checkableStats(pack).length ? `
# 判定（最重要）
- 成否はあなたではなくサイコロが決めます。プレイヤーの行動に少しでも失敗の余地があるなら（呪文、授業、試験、説得、嘘、隠れて動く、盗み聞き、調べもの、飛ぶ、戦う、危険な場所に入る、など）、必ず判定してください。会話や移動だけのときは不要です。
- 「判定（確定済み）」が渡されたら、その結果どおりに描写してください。check には key="" を返します。
- 確定済みの判定がないときは、行動の難しさに合う難度を選び、「判定結果表」の○×どおりに描写し、使ったステータスと難度を check に返してください。判定しないときは check の key を "" にします。
- 失敗はちゃんと失敗として描いてください（見つかる、間に合わない、恥をかく、怪我をする、減点される）。失敗から新しい展開が生まれるのは歓迎です。
- 大きな成果（秘密の発見、強い相手に勝つ、立入禁止の場所を突破する）は、難や至難の判定に成功したときだけ得られます。
- 判定に成功すると、その能力はプログラムが自動で伸ばします。判定と関係のない能力の数値は、授業で練習した・大きな経験をしたときにだけ小さく動かしてください。
- 行動候補（suggestions）は、性格の違う3つを出してください。少なくとも2つは判定が絡むもの（違うステータスを使うもの）にし、key と level を付けます。判定が絡まない候補は key="" level="なし" にします。
` : ''}${pack.events.length ? `
# 予定の出来事（原作・史実）と分岐
- 「時期の制約」は物語の進み方を守るためのものです。必ず守ってください。プレイヤーが制約に反することをしようとしたら、判定の失敗、邪魔が入る、手がかりが足りない、などで先送りにします。
- ただし、これまでの展開ですでに制約を越えてしまっていることは、起きたこととして受け入れ、そこからさらに先へは急がない方向で使ってください。
- 物語は「これから起きる出来事」の順に、その日付に向けて少しずつ進めてください。真相や山場を先取りしてはいけません。予定の出来事がない日々は、授業、宿題、寮の生活、人間関係、小さな事件で満たしてください。
- 出来事に「判定（確定済み）」が付いていたら、その結果どおりに描写してください。
- 「このターンに起きる出来事」が渡されたら、プレイヤーの行動と自然につなげて描写してください。プレイヤーがその場にいなければ、噂や知らせとして伝わる形でもかまいません。
- 「原作から分岐」と書かれた出来事は、原作どおりには起きません。今の状態とこれまでの展開から、別の形で起きるのか、起きないのか、代わりに何が起きるのかをあなたが考えて描写してください。参考の一例があっても縛られる必要はありません。原作に引き戻さないでください。
- 「これから起きる出来事」は先の予定です。伏線として匂わせてもよいですが、先取りして起こしてはいけません。
- どの出来事も分岐しえます。プレイヤーの行動で先の出来事の前提が変わったら、set_flag で key="${altFlag('出来事ID')}"、value="何がどう変わったかの短いメモ" を出してください。その出来事の時が来たら、プログラムがそのメモを添えて「原作から分岐」として渡します。「分岐の目安」に書かれたフラグがあれば、それも立ててください。
- 分岐の結果は、その場にいない人物の関係や数値、寮点、城の空気にも波及させてください。
- ほかの人物も自分の目的で動いています。プレイヤーがいない場所でも、原作の人物は自分の予定どおりに行動し、その結果が噂や出来事としてプレイヤーに届きます。
` : ''}${pack.influences.length || pack.triggers.length ? `
# ステータスの影響
- 「今効いている影響」は、プレイヤーや世界の数値が周りに与えている影響です。人物の態度、噂、先生や学校の対応に必ず反映してください。
- 数値の変化は、関係する人物の数値（好感度・疑念など）や世界の数値にも、筋が通る範囲で波及させてください。
- 人前で目立つこと（活躍、失敗、規則違反、手柄）をしたら、評判を必ず動かしてください（良いことで+、悪いことで−）。
- 先生は、プレイヤーの寮だけでなく、授業や廊下でほかの寮の生徒にも加点・減点します。場面にいる他寮の生徒の点数も動かしてください。
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
- check：このターンの判定 { key, level }（判定しないときは key=""）
- suggestions：次の行動の候補3つ [{ text（20字程度）, key（判定に使うステータス。なければ ""）, level }]
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
    これまでの主な出来事: state.events.slice(-25).map((e) => `${e.date} ${e.text}`),
  }
}

const cardText = (c: StoryCard) => `【ターン${c.turn}／${c.date}${c.slot ? '・' + c.slot : ''}】\nプレイヤーの行動：${c.action}\n${c.narrative}`

export interface TurnExtras {
  due: DueEvent[]
  upcoming: WorldEvent[]
  /** 判定結果表（判定に使えるステータスがない世界では空） */
  checkTable: string
  /** 今効いている影響 */
  influences?: string[]
  /** 時期の制約 */
  constraints?: string[]
  /** プレイヤーが候補から選んだ行動の判定（確定済み） */
  playerCheck?: CheckResult
  /** 出来事に付いた判定（確定済み）。出来事IDごと */
  eventChecks?: Record<string, CheckResult[]>
}

const eventLine = (state: GameState) => (e: WorldEvent) => {
  const note = state.flags[altFlag(e.id)]
  return `- [${e.id}] ${formatDate(e.date)}${e.slot ? '・' + e.slot : ''}「${e.title}」：${e.canon}${
    e.branchHint ? `\n  分岐の目安：${e.branchHint}` : ''
  }${typeof note === 'string' ? `\n  すでに記録された変化：${note}` : ''}`
}

const dueLine = (checks: Record<string, CheckResult[]>) => (d: DueEvent) => {
  const rolled = checks[d.id]?.length ? `\n  判定（確定済み）：${checks[d.id].map(checkLine).join('／')}` : ''
  return d.mode === 'canon'
    ? `- 「${d.title}」：${d.text}${d.branchHint ? `\n  分岐の目安：${d.branchHint}` : ''}${rolled}`
    : `- 「${d.title}」（原作から分岐）：原作ではこうなる予定だった→${d.text}\n  変化：${d.reason}${
        d.example ? `\n  参考の一例：${d.example}` : ''
      }${rolled}\n  今の状況からあなたが展開を決める。`
}

export function buildTurnPrompt(
  pack: WorldPack,
  state: GameState,
  action: string,
  isOpening: boolean,
  extras: TurnExtras = { due: [], upcoming: [], checkTable: '' },
): string {
  const recent = state.cards.slice(-RECENT_TURNS).map(cardText).join('\n\n')
  const due = extras.due
  return `# 現在の状態
${JSON.stringify(compactState(pack, state), null, 1)}

# これまでの要約
${state.summary || '（まだない）'}

# 隠し筋書き（プレイヤーには見せない。展開の参考にする）
${state.hiddenPlot || '（なし）'}
${state.plotNotes.length ? `\n自分のメモ：\n${state.plotNotes.map((n) => `- ${n}`).join('\n')}\n` : ''}${
    due.length
      ? `\n# このターンに起きる出来事（必ず描写する）\n${due
          .map(dueLine(extras.eventChecks ?? {}))
          .join('\n')}\n`
      : ''
  }${extras.upcoming.length ? `\n# これから起きる出来事（先取りしない）\n${extras.upcoming.map(eventLine(state)).join('\n')}\n` : ''}${
    extras.influences?.length ? `\n# 今効いている影響\n${extras.influences.map((t) => `- ${t}`).join('\n')}\n` : ''
  }${extras.constraints?.length ? `\n# 時期の制約（必ず守る）\n${extras.constraints.map((t) => `- ${t}`).join('\n')}\n` : ''}${
    extras.checkTable ? `\n# このターンの判定結果表\n${extras.checkTable}\n` : ''
  }
# 直近の展開
${recent || '（まだない）'}

# ${isOpening ? 'ゲーム開始' : 'プレイヤーの行動'}
${isOpening ? pack.opening : action}${
    extras.playerCheck ? `\n判定（確定済み）：${checkLine(extras.playerCheck)}。この結果どおりに描写すること。` : ''
  }`
}

export function buildSummaryPrompt(previous: string, cards: StoryCard[]): string {
  return `次の「これまでの要約」と「新しい展開」を合わせて、物語の要約を作り直してください。
後で物語を続けるために必要な事実（誰が何をしたか、関係の変化、約束、未解決の謎、重要な出来事の日付）を優先し、1200字以内にまとめます。
古い出来事も消さず、日付つきで一行ずつ短く残してください（新しいものほど詳しく）。
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
    check: {
      type: 'object',
      properties: { key: { type: 'string' }, level: { type: 'string', enum: ['なし', ...LEVELS] } },
      required: ['key', 'level'],
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          key: { type: 'string' },
          level: { type: 'string', enum: ['なし', ...LEVELS] },
        },
        required: ['text', 'key', 'level'],
      },
    },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: OP_NAMES.filter((o) => o !== 'check') },
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
        },
        required: ['op'],
      },
    },
  },
  required: ['narrative', 'check', 'suggestions', 'ops'],
} as const

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
} as const
