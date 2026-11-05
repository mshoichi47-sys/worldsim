import { useEffect, useState } from 'react'
import { GEMINI_MODELS } from '../ai/provider'
import { onUsageChange, readUsage } from '../ai/usage'
import type { ProviderKind } from '../settings'
import { useApp } from '../store'

export function SettingsPanel() {
  const { settings, updateSettings } = useApp()
  const usage = useUsage()

  return (
    <div className="panel">
      <h2>AIの接続先</h2>
      <div className="field">
        <label htmlFor="provider">接続先</label>
        <select
          id="provider"
          value={settings.provider}
          onChange={(e) => updateSettings({ provider: e.target.value as ProviderKind })}
        >
          <option value="gemini">Gemini（無料枠）</option>
          <option value="ollama">Ollama（Macのローカルモデル）</option>
          <option value="mock">テスト（AIなし・回数を使わない）</option>
        </select>
      </div>

      {settings.provider === 'gemini' && (
        <>
          <div className="field">
            <label htmlFor="key">APIキー</label>
            <input
              id="key"
              type="password"
              autoComplete="off"
              value={settings.geminiKey}
              placeholder="Google AI Studioで取得したキー"
              onChange={(e) => updateSettings({ geminiKey: e.target.value })}
            />
            <span className="hint">この端末のブラウザにだけ保存されます。無料枠で送った内容はGoogleの改善に使われることがあるので、個人情報は入力しないでください。</span>
          </div>
          <div className="field">
            <label htmlFor="model">モデル</label>
            <select id="model" value={settings.geminiModel} onChange={(e) => updateSettings({ geminiModel: e.target.value })}>
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className="hint">枠はモデルごとに別。今日の枠が切れたら別のモデルに変えると続けられます。</span>
          </div>
        </>
      )}

      {settings.provider === 'ollama' && (
        <>
          <div className="field">
            <label htmlFor="ourl">アドレス</label>
            <input id="ourl" value={settings.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} />
            <span className="hint">Macなら http://localhost:11434。スマホからは同じWi-FiでMacのアドレスを指定。Ollama側でブラウザからの接続を許可する設定が必要です。</span>
          </div>
          <div className="field">
            <label htmlFor="omodel">モデル名</label>
            <input id="omodel" value={settings.ollamaModel} onChange={(e) => updateSettings({ ollamaModel: e.target.value })} />
          </div>
        </>
      )}

      <h2>今日の使用回数</h2>
      <p className="usage">
        合計 {usage.total} 回
        {Object.entries(usage.byModel).map(([m, n]) => `／${m}：${n}回`).join('')}
        <br />
        日本時間17時ごろ（夏は16時）にリセットされます。
      </p>
    </div>
  )
}

function useUsage() {
  const [u, setU] = useState(readUsage)
  useEffect(() => {
    const off = onUsageChange(() => setU(readUsage()))
    return () => {
      off()
    }
  }, [])
  return u
}
