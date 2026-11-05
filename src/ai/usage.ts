/** 1日の呼び出し回数（太平洋時間の日付で区切る＝Geminiの枠のリセットに合わせる） */

const KEY = 'worldsim.usage'

export interface UsageDay {
  day: string
  total: number
  byModel: Record<string, number>
}

export function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now)
}

export function readUsage(): UsageDay {
  const today = pacificDay()
  try {
    const raw = localStorage.getItem(KEY)
    const u = raw ? (JSON.parse(raw) as UsageDay) : null
    if (u && u.day === today) return u
  } catch {
    /* 保存領域が使えない環境では数えない */
  }
  return { day: today, total: 0, byModel: {} }
}

const listeners = new Set<() => void>()
export function onUsageChange(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function recordUsage(model: string) {
  const u = readUsage()
  u.total += 1
  u.byModel[model] = (u.byModel[model] ?? 0) + 1
  try {
    localStorage.setItem(KEY, JSON.stringify(u))
  } catch {
    /* 無視 */
  }
  listeners.forEach((fn) => fn())
}
