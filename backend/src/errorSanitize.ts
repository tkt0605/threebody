// エラー本文を外（SSE・HTTPレスポンス・サーバーログ）へ出す前に、秘匿値を伏せ字化する。
//
// プロバイダーは認証エラー時に、受け取ったキーをそのままエラー本文へ echo back することがある。
// server.ts の catch は err.message を無検査で SSE に流し、console.error は err をオブジェクトごと
// 出していたため、そこがそのまま流出経路になっていた。
//
// 共有APIキーでは被害の範囲が変わる。ユーザー自身のキーなら本人が再発行すれば済むが、
// 共有キーは全ユーザーが同じ1本を使うため、1人がブラウザの開発者ツールを開けば全員分が終わる。
// 外へ出す文字列は必ずここを通すこと。
//
// 伏せ字化そのものはフロントと同じ src/lib/redact.ts を使う。実装を複製すると、
// 片方に網を足したときにもう片方が取り残されるため、意図的に1本に寄せている。
// （redact.ts は依存を1つも持たない純粋なモジュールなので、ここから読んでも安全）
import { redactText } from '../../src/lib/redact'

type KeyBearing = { apiKey?: string | undefined }

// この時点で手元にある秘匿値を全て集める。
// 運営の共有キーだけでなく、リクエストで渡ってきたユーザーのキーも対象にする。
// フロント側（useChat.ts の classifyError）でも伏せているが、二重にしておく。
// 一度送ってしまったレスポンスも、一度残ってしまったログも取り消せない。
export function collectSecrets(
  source: {
    bodies?: readonly KeyBearing[] | undefined
    apiKey?: string | undefined
  } = {},
): string[] {
  return [
    process.env.SHARED_ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    source.apiKey,
    ...(source.bodies ?? []).map(b => b.apiKey),
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

// 外へ出してよい形のエラーメッセージを作る。
// redactText は「手元の実値との照合」に加えてパターン照合も行うため、
// ここに渡し損ねたキー（環境変数側のキーがエラー本文に混ざった等）も二段目で拾える
export function sanitizeErrorMessage(err: unknown, secrets: readonly string[]): string {
  return redactText(err instanceof Error ? err.message : String(err), secrets)
}
