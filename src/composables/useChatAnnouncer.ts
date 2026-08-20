import { ref, watch } from 'vue'
import { useChat } from './useChat'
import type { AiState } from './useChat'
import { stripMarkdown } from '../lib/stripMarkdown'
import type { ErrorBlock, Message, TextBlock } from '../types/message'

// 画面の変化を「音声だけで追っている人」へ伝えるための1行を組み立てる。
//
// なぜ本文のDOMに直接 aria-live を付けないか：ストリーミング中の本文は1トークンごとに
// 書き換わるため、そこをライブリージョンにするとスクリーンリーダーが更新のたびに
// 読み直し、実質なにも聞き取れなくなる。ここでは
//   (1) 状態が変わった瞬間（考えている／書き出している／検算している）
//   (2) 応答が完成した瞬間の本文（またはエラー）
// の2種類だけを流し、本文側は aria-busy で「まだ書き換わっている」ことだけを伝える

const STATE_LABEL: Partial<Record<AiState, string>> = {
  thinking:     '考えています',
  converging:   '応答を書き出しています',
  // 本文はこの時点で読み終わっている。「まだ何か動いている」ことだけを伝える
  reviewing:    '他の体が答えを検算しています',
}

// 完成したアシスタントメッセージを読み上げ用の1行にする（テストのためexport）
export function describeCompletedMessage(msg: Message | undefined): string {
  if (!msg || msg.role !== 'assistant') return ''

  const error = msg.blocks.find((b): b is ErrorBlock => b.type === 'error')
  if (error) return `エラー: ${error.message}`

  const text = msg.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.content)
    .join('\n')
    .trim()

  return text ? `応答: ${stripMarkdown(text)}` : ''
}

const announcement = ref('')

// 幅ゼロ空白。読み上げ内容は変えずにDOMのテキストだけを変える用
const ZERO_WIDTH_SPACE = '\u200B'

// 同じ文字列を代入してもDOMは変化せず、スクリーンリーダーは読み直さない。
// 「同じ状態にもう一度なった」ことも伝わるよう、連続した同一メッセージのときだけ
// 幅ゼロの文字を足して差分を作る
function announce(text: string): void {
  if (!text) return
  announcement.value = announcement.value === text ? text + ZERO_WIDTH_SPACE : text
}

const { messages, aiState } = useChat()

watch(aiState, (state) => {
  const label = STATE_LABEL[state]
  if (label) announce(label)
})

// ストリーミングが true → false に変わった瞬間だけ本文を流す。
// 中断された場合はメッセージごと取り除かれる（cancelGeneration）ため、ここは通らない
watch(() => messages.value.at(-1)?.streaming, (streaming, prev) => {
  if (prev !== true || streaming !== false) return
  announce(describeCompletedMessage(messages.value.at(-1)))
})

export function useChatAnnouncer() {
  return { announcement, announce }
}
