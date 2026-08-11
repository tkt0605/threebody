// ルーターを実サーバーに載せて叩くための最小ヘルパー。
//
// supertest 等を足さずに済ませるため、ephemeralポート（0）で listen して fetch で叩く。
// SSEのレスポンスは res.end() まで待ってから本文全体が読める（response.text()）ので、
// ストリーミング前提のルートでもこのままで検証できる。
//
// ファイル名を *.test.ts にしていないのは、vitest.config.ts の include に拾わせないため。
import express, { type Router } from 'express'
import type { AddressInfo } from 'node:net'

export async function withRouter<T>(router: Router, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express()
  app.use(express.json())
  app.use('/api', router)

  const server = app.listen(0)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const { port } = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    // fetch がkeep-aliveでソケットを掴んだままだと close() が返らないため、
    // 接続を明示的に切ってから閉じる
    server.closeAllConnections()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
}

// SSEの生テキスト（"data: {...}\n\n" の連なり）をイベント配列に解く。
// [DONE] は JSON ではないので、来たことだけを done として返す
export function parseSSE(raw: string): { events: Record<string, unknown>[]; done: boolean } {
  const events: Record<string, unknown>[] = []
  let done = false

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice('data: '.length).trim()
    if (payload === '[DONE]') { done = true; continue }
    events.push(JSON.parse(payload) as Record<string, unknown>)
  }
  return { events, done }
}
