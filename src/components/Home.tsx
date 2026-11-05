import { useEffect, useRef, useState } from 'react'
import { formatWhen } from '../engine/state'
import { useApp } from '../store'
import { WORLDS } from '../worlds'
import { SettingsPanel } from './SettingsPanel'

export function Home() {
  const { saves, refreshSaves, startNew, resume, removeSave, importFile, error, clearMessages } = useApp()
  const [showSettings, setShowSettings] = useState(false)
  // 名前を聞く世界で「最初から始める」を押したとき、その世界のIDが入る
  const [naming, setNaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshSaves()
  }, [refreshSaves])

  if (showSettings) {
    return (
      <div className="home">
        <button className="btn" onClick={() => setShowSettings(false)}>戻る</button>
        <SettingsPanel />
      </div>
    )
  }

  return (
    <div className="home">
      <h1>WorldSim</h1>
      <p className="lead">世界を選んで、好きな行動を書いてください。世界と人物が反応します。進行は毎ターン自動で保存されます。</p>

      {WORLDS.map((w) => {
        const save = saves.find((s) => s.worldId === w.id)
        const confirmNew = () => !save || confirm(`「${w.title}」の今の進行は消えます。最初から始めますか？`)
        return (
          <section className="world" key={w.id}>
            <h2>{w.title}</h2>
            {w.subtitle && <div className="sub">{w.subtitle}</div>}
            {save && (
              <div className="save">
                続き：{formatWhen(w, save.state)}（{save.state.turn}ターン）
              </div>
            )}
            <div className="actions">
              {save && <button className="btn primary" onClick={() => void resume(w.id)}>続きから遊ぶ</button>}
              <button
                className={save ? 'btn' : 'btn primary'}
                onClick={() => {
                  if (!confirmNew()) return
                  if (w.askName) setNaming(w.id)
                  else void startNew(w.id)
                }}
              >
                最初から始める
              </button>
              {save && (
                <button
                  className="btn danger"
                  onClick={() => confirm(`「${w.title}」の進行を削除しますか？`) && void removeSave(w.id)}
                >
                  進行を削除
                </button>
              )}
            </div>
            {naming === w.id && (
              <form
                className="name-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void startNew(w.id, name)
                }}
              >
                <label htmlFor={`name-${w.id}`}>あなたの名前</label>
                <div className="row">
                  <input id={`name-${w.id}`} value={name} autoFocus placeholder="例：エマ・ブルック" onChange={(e) => setName(e.target.value)} />
                  <button className="btn primary" type="submit" disabled={!name.trim()}>この名前で始める</button>
                </div>
              </form>
            )}
          </section>
        )
      })}

      <div className="home-tools">
        <button className="btn" onClick={() => setShowSettings(true)}>設定</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>書き出したファイルを読み込む</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importFile(f)
            e.target.value = ''
          }}
        />
      </div>
      {error && (
        <p className="msg error">
          {error}
          <button className="btn" onClick={clearMessages}>閉じる</button>
        </p>
      )}
    </div>
  )
}
