export interface SearchHit {
  title: string
  url: string
  snippet: string
}

export const SEARCH_TIMEOUT_MS = 8000

// URLを設定した環境だけで有効。共有キー経路はこの設定に関係なく無効にする。
export function searchEnabled(): true | null {
  return process.env.SEARCH_API_URL?.trim() ? true : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// SearXNG (results/content) と Brave (web.results/description) の差はここに閉じる。
function toSearchHits(data: unknown): SearchHit[] {
  if (!isRecord(data)) throw new Error('検索APIの応答形式が不正です')
  const results: unknown = isRecord(data.web) ? data.web.results : data.results
  if (!Array.isArray(results)) throw new Error('検索APIの応答に results がありません')
  const hits: SearchHit[] = []
  for (const result of results as unknown[]) {
    if (!isRecord(result)) continue
    const { title, url } = result
    const snippet = result.snippet ?? result.content ?? result.description
    if (typeof title !== 'string' || typeof url !== 'string' || typeof snippet !== 'string') continue
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue
    } catch { continue }
    hits.push({ title: title.slice(0, 300), url, snippet: snippet.slice(0, 300) })
    if (hits.length === 3) break
  }
  return hits
}

export async function searchWeb(query: string): Promise<SearchHit[]> {
  if (!searchEnabled() || !query.trim()) return []
  const url = new URL(process.env.SEARCH_API_URL!.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('検索APIにはHTTP(S)のURLを指定してください')
  url.searchParams.set('q', query)
  const brave = url.hostname === 'api.search.brave.com'
  if (brave) url.searchParams.set('count', '3')
  else url.searchParams.set('format', 'json')
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = process.env.SEARCH_API_KEY?.trim()
  if (key) {
    if (brave) headers['X-Subscription-Token'] = key
    else headers.Authorization = `Bearer ${key}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'error' })
    // 応答本文は認証情報を含む可能性があるので、エラーに取り込まない。
    if (!response.ok) throw new Error(`検索APIがHTTP ${response.status}を返しました`)
    const data: unknown = await response.json()
    return toSearchHits(data)
  } finally {
    clearTimeout(timer)
  }
}
