import { createHighlighter, type Highlighter } from 'shiki'
import { createCssVariablesTheme } from '@shikijs/core'
import { ref } from 'vue'

// 会話に出てくるコードの大半はこの範囲に収まる（bash系 + JS/TS + Python + JSON）。
// 言語を増やすほど初期化の非同期待ちとバンドルが伸びるので、ここは意図的に狭くする
const LANGS = ['bash', 'javascript', 'typescript', 'jsx', 'tsx', 'python', 'json'] as const

// トークン色は --shiki-token-* カスタムプロパティに逃がし、MessageBubble.vue の
// --code-* と同じ場所（.prose-content / .dark .prose-content）で明度を切り替える。
// shiki 側にライト/ダーク2テーマを持たせるとテーマ切替のタイミングをもう1つ増やすことになるため
const THEME_NAME = 'css-variables'
const theme = createCssVariablesTheme({ name: THEME_NAME, variablePrefix: '--shiki-', fontStyle: true })

let highlighter: Highlighter | null = null
export const highlighterReady = ref(false)

createHighlighter({ themes: [theme], langs: [...LANGS] })
  .then((h) => {
    highlighter = h
    highlighterReady.value = true
  })
  .catch(() => {
    // 初期化に失敗しても致命的ではない。呼び出し側は highlighter が null のままプレーン表示へ倒れる
  })

// 未ロードの言語・初期化未完了時は null（呼び出し側が既存のプレーン表示にフォールバックする）
export function highlightCode(code: string, lang: string): string | null {
  if (!highlighter) return null
  const id = lang.trim().toLowerCase()
  if (!id || !highlighter.getLoadedLanguages().includes(id)) return null
  return highlighter.codeToHtml(code, { lang: id, theme: THEME_NAME })
}
