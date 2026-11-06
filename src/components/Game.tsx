import { useEffect, useRef, useState } from 'react'
import { dueEvents, resolveCheck } from '../engine/rules'
import { formatDate, formatWhen } from '../engine/state'
import type { Suggestion } from '../engine/types'
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

  const send = (action: string, chosen?: Suggestion) => {
    if (!action.trim() || busy) return
    setSeenTurn(game.turn)
    setTab('story')
    void act(action.trim(), chosen).then(() => {
      if (!useApp.getState().error && !chosen) setText('')
    })
  }
  // 候補の成功率（今のステータスで計算。サイコロの目は関係ないので roll=0 を渡す）
  const chanceOf = (s: Suggestion) => (s.key ? resolveCheck(pack, game, s.key, s.level, 0) : undefined)
  const pathTitle = (id?: string) => pack.paths.find((p) => p.id === id)?.title
  // 次のターンの進み方（予定の出来事が来ていれば場面）
  const nextPace = pack.time.digestDays ? (dueEvents(pack, game).length ? '場面' : (game.pace ?? '日々')) : undefined
  const range = (from: string, to?: string) => {
    if (!to) return formatDate(from)
    const [, m1] = from.split('-')
    const [, m2, d2] = to.split('-').map(Number)
    return `${formatDate(from)}〜${m1 === String(m2).padStart(2, '0') ? '' : `${m2}月`}${d2}日`
  }
  const retryOpening = game.cards.length === 0

  return (
    <div className="game" data-theme={pack.theme}>
      <header className="topbar">
        <button className="back" onClick={goHome} aria-label="世界の選択に戻る">←</button>
        <span className="title">{pack.title}</span>
        <span className="when">
          {nextPace === '場面' && <span className="pace">場面</span>}
          {formatWhen(pack, game)}
        </span>
      </header>

      <div className="main">
        <div className="scroll" key={tab}>
          {tab === 'story' && (
            <div className="story">
              {game.cards.length === 0 && !busy && <p className="empty">導入場面を作れませんでした。下のボタンで再試行してください。</p>}
              {game.cards.map((c) => (
                <article className={`card${isNew(c.turn) ? ' new' : ''}`} key={c.turn}>
                  <div className="stamp">
                    {range(c.date, c.dateEnd)}
                    {!c.dateEnd && c.slot ? `　${c.slot}` : ''}
                  </div>
                  <div>
                    {c.events?.map((t) => <div className="event-title" key={t}>{t}</div>)}
                    {c.turn > 1 && <div className="action">行動：<b>{c.action}</b></div>}
                    {c.checks?.map((k, i) => (
                      <div className={`check ${k.ok ? 'ok' : 'ng'}`} key={i}>
                        <span className="check-what">
                          {k.label ? `${k.label}　` : ''}
                          {k.statLabel}・{k.level}（成功率{k.chance}%）
                        </span>
                        <b>{k.ok ? '成功' : '失敗'}</b>
                      </div>
                    ))}
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
          {tab === 'status' && <StatusPanel pack={pack} game={game} onAction={busy ? undefined : send} />}
          {tab === 'settings' && <SettingsPanel />}
        </div>
        <aside className="side scroll">
          <StatusPanel pack={pack} game={game} onAction={busy ? undefined : send} />
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
                    {game.suggestions.map((s, i) => {
                      const c = chanceOf(s)
                      return (
                        <button key={i} disabled={busy} onClick={() => send(s.text, s)}>
                          <span>{s.text}</span>
                          {(c || s.path) && (
                            <small>
                              {[pathTitle(s.path), c && `${c.statLabel}・${c.level}　${c.chance}%`].filter(Boolean).join('　')}
                            </small>
                          )}
                        </button>
                      )
                    })}
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
