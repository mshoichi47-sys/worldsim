import { useEffect, useRef, useState } from 'react'
import { formatDate, formatWhen } from '../engine/state'
import { useApp } from '../store'
import { SettingsPanel } from './SettingsPanel'
import { StatusPanel } from './StatusPanel'

type Tab = 'story' | 'status' | 'settings'

export function Game() {
  const { pack, game, busy, error, warning, act, goHome, clearMessages } = useApp()
  const [tab, setTab] = useState<Tab>('story')
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  // この画面を開いた後に増えたカードだけ、静かに現れる動きを付ける
  const [seenTurn, setSeenTurn] = useState(game?.turn ?? 0)

  const cardCount = game?.cards.length ?? 0
  useEffect(() => {
    if (tab === 'story') endRef.current?.scrollIntoView({ block: 'end' })
  }, [cardCount, busy, tab])

  if (!pack || !game) return null
  const isNew = (turn: number) => turn > seenTurn

  const send = (action: string) => {
    if (!action.trim() || busy) return
    setSeenTurn(game.turn)
    void act(action.trim()).then(() => {
      if (!useApp.getState().error) setText('')
    })
  }
  const retryOpening = game.cards.length === 0

  return (
    <div className="game">
      <header className="topbar">
        <button className="back" onClick={goHome} aria-label="世界の選択に戻る">←</button>
        <span className="title">{pack.title}</span>
        <span className="when">{formatWhen(pack, game)}</span>
      </header>

      <div className="main">
        <div className="scroll" key={tab}>
          {tab === 'story' && (
            <div className="story">
              {game.cards.length === 0 && !busy && <p className="empty">導入場面を作れませんでした。下のボタンで再試行してください。</p>}
              {game.cards.map((c) => (
                <article className={`card${isNew(c.turn) ? ' new' : ''}`} key={c.turn}>
                  <div className="stamp">{formatDate(c.date)}{c.slot ? `　${c.slot}` : ''}</div>
                  <div>
                    {c.turn > 1 && <div className="action">行動：<b>{c.action}</b></div>}
                    <div className="narrative">{c.narrative}</div>
                    {c.changes.length > 0 && (
                      <div className="changes">{c.changes.map((ch, i) => <span key={i}>{ch}</span>)}</div>
                    )}
                  </div>
                </article>
              ))}
              {busy && <p className="thinking" role="status">世界が動いています…</p>}
              <div ref={endRef} />
            </div>
          )}
          {tab === 'status' && <StatusPanel pack={pack} game={game} />}
          {tab === 'settings' && <SettingsPanel />}
        </div>
        <aside className="side scroll">
          <StatusPanel pack={pack} game={game} />
        </aside>
      </div>

      {tab === 'story' ? (
        <div className="composer">
          {error && (
            <p className="msg error" role="alert">
              {error}
              <button className="btn" onClick={clearMessages}>閉じる</button>
            </p>
          )}
          {warning && <p className="msg warn">{warning}</p>}
          <div className="composer-inner">
            {retryOpening ? (
              <button className="btn primary" disabled={busy} onClick={() => void act('')}>導入場面を作る</button>
            ) : (
              <>
                {game.suggestions.length > 0 && (
                  <div className="suggestions">
                    {game.suggestions.map((s, i) => (
                      <button key={i} disabled={busy} onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                )}
                <form
                  className="input-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    send(text)
                  }}
                >
                  <textarea
                    rows={1}
                    value={text}
                    placeholder="何をする？"
                    aria-label="行動を入力"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        send(text)
                      }
                    }}
                  />
                  <button className="btn primary" type="submit" disabled={busy || !text.trim()}>送る</button>
                </form>
              </>
            )}
          </div>
        </div>
      ) : (
        <div />
      )}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'story'} onClick={() => setTab('story')}>物語</button>
        <button role="tab" data-tab="status" aria-selected={tab === 'status'} onClick={() => setTab('status')}>状況</button>
        <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>設定</button>
      </nav>
    </div>
  )
}
