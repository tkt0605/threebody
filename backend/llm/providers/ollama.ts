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

// OpenAI互換の /v1/chat/completions は think:false を無視し、reasoning搭載モデルは
// 内部思考をそのまま流し続ける（content は空のまま）。ネイティブ /api/chat だけが
// think:false を尊重するため、Ollamaはこちらを直接叩く。
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

// Ollamaのreasoning搭載モデル（gemma4のthinking版等）はOpenAI互換エンドポイントだと
// think:false が効かず、内部思考を reasoning フィールドに流し続け content が空になる。
// ネイティブ /api/chat なら think:false が効き、内部思考を生成させずに済む。
// 一部モデル・量子化ではstopトークンとして正しく扱われず、素のテキストとして
// 出力に混じることがある（例: sarashina2.2系が末尾に </s> を出す）
const OLLAMA_SPECIAL_TOKENS = new Set(['</s>', '<|endoftext|>', '<|im_end|>', '<|eot_id|>', '<end_of_turn>'])

export async function streamOllamaNative(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  onContent: (text: string) => void,
): Promise<void> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      think:   false,
      stream:  true,
      options: { num_predict: maxTokens },
    }),
  })
  if (!response.ok || !response.body) {
    // 本文はプロバイダーが何を返すか制御できない。診断に足りる長さだけ残して切り詰める
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
  }

  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { message?: { content?: string } }
      const content = chunk.message?.content
      if (content && !OLLAMA_SPECIAL_TOKENS.has(content.trim())) onContent(content)
    }
  }
}
