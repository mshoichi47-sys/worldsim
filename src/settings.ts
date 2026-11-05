import { geminiProvider, ollamaProvider, type AIProvider } from './ai/provider'
import { mockProvider } from './ai/mock'

export type ProviderKind = 'gemini' | 'ollama' | 'mock'

export interface Settings {
  provider: ProviderKind
  geminiKey: string
  geminiModel: string
  ollamaUrl: string
  ollamaModel: string
}

const KEY = 'worldsim.settings'

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-3.8-flash',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma4',
}

/** APIキーはこの端末のブラウザにだけ保存する */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    /* 保存領域が使えない環境では既定値 */
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 無視 */
  }
}

export function makeProvider(s: Settings): AIProvider {
  switch (s.provider) {
    case 'gemini':
      return geminiProvider(s.geminiKey.trim(), s.geminiModel)
    case 'ollama':
      return ollamaProvider(s.ollamaUrl, s.ollamaModel)
    case 'mock':
      return mockProvider()
  }
}
