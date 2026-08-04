// Ollamaがこのデプロイで実際に使えるかどうかの宣言。
//
// isBodyUsable（フロント）は provider が ollama ならキー無しでも常に true を返す。
// ローカル開発では正しい前提だが、Ollamaに到達できない本番環境では
// 「使えるように見えて実際は使えない」偽陽性を生む（送信して初めて接続エラーで失敗する）。
// 運営がデプロイ先ごとに明示的に申告できるよう、環境変数で上書きできるようにする。
//
// 未設定なら true（ローカル開発の既存動作を壊さないための既定値）。
// 本番では OLLAMA_ENABLED=false を明示的に設定する運用を想定
export function ollamaEnabled(): boolean {
  const raw = process.env.OLLAMA_ENABLED?.trim().toLowerCase()
  return raw !== 'false' && raw !== '0'
}
