import { ApiError, GoogleGenAI } from '@google/genai'
import type { GameState, WorldPack } from '../engine/types'
import { recordUsage } from './usage'

export type AIErrorKind = 'quota' | 'auth' | 'network' | 'blocked' | 'bad_output' | 'other'

export class AIError extends Error {
  kind: AIErrorKind
  constructor(kind: AIErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface AIRequest {
  kind: 'turn' | 'summary'
  system: string
  prompt: string
  schema: object
  /** テスト用接続だけが使う */
  meta?: { pack: WorldPack; state: GameState; action: string }
}

export interface AIProvider {
  /** 使用量メーターに出す名前 */
  label: string
  /** JSON文字列を返す */
  generate(req: AIRequest): Promise<string>
}

export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash（標準）' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite（軽い）' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B' },
] as const

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function geminiProvider(apiKey: string, model: string): AIProvider {
  const ai = new GoogleGenAI({ apiKey })
  const call = async (req: AIRequest) => {
    const res = await ai.models.generateContent({
      model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        temperature: req.kind === 'turn' ? 0.9 : 0.3,
      },
    })
    const blocked = res.promptFeedback?.blockReason
    const finish = res.candidates?.[0]?.finishReason
    if (blocked || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') {
      throw new AIError('blocked', '安全フィルターで生成が止まりました。行動の表現を変えて試してください。')
    }
    const text = res.text
    if (!text) throw new AIError('bad_output', 'AIの応答が空でした。')
    return text
  }

  return {
    label: model,
    async generate(req) {
      if (!apiKey) throw new AIError('auth', '設定でGeminiのAPIキーを入力してください。')
      for (let attempt = 0; ; attempt++) {
        try {
          recordUsage(model)
          return await call(req)
        } catch (e) {
          if (e instanceof AIError) throw e
          if (e instanceof ApiError) {
            if (e.status === 429) {
              if (attempt === 0) { await sleep(6000); continue }
              throw new AIError('quota', 'Geminiの回数上限に達しました。1分ほど待つか、今日の枠切れなら設定でモデルを変えてください（枠は日本時間17時ごろリセット）。')
            }
            if (e.status === 400 && /api key/i.test(e.message)) throw new AIError('auth', 'APIキーが正しくないようです。設定を確認してください。')
            if (e.status === 401 || e.status === 403) throw new AIError('auth', 'APIキーが使えません。設定を確認してください。')
            if (e.status === 404) throw new AIError('other', `モデル「${model}」が見つかりません。設定で別のモデルを選んでください。`)
            if (e.status >= 500 && attempt === 0) { await sleep(3000); continue }
            throw new AIError('other', `Geminiのエラー（${e.status}）：${e.message}`)
          }
          throw new AIError('network', `通信できませんでした：${(e as Error).message}`)
        }
      }
    },
  }
}

export function ollamaProvider(baseUrl: string, model: string): AIProvider {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    label: `ollama:${model}`,
    async generate(req) {
      recordUsage(`ollama:${model}`)
      let res: Response
      try {
        res = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            format: req.schema,
            options: { temperature: req.kind === 'turn' ? 0.9 : 0.3 },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt },
            ],
          }),
        })
      } catch (e) {
        throw new AIError('network', `Ollamaに接続できません（${base}）。Macで起動しているか、接続許可の設定を確認してください：${(e as Error).message}`)
      }
      if (!res.ok) throw new AIError('other', `Ollamaのエラー（${res.status}）：${await res.text()}`)
      const json = (await res.json()) as { message?: { content?: string } }
      const text = json.message?.content
      if (!text) throw new AIError('bad_output', 'Ollamaの応答が空でした。')
      return text
    },
  }
}
