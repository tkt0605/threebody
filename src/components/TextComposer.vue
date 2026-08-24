<script setup lang="ts">
import { ref, nextTick, computed, onMounted, watch } from 'vue'

// テキストで送るための入力欄。
//
// 【なぜ必要か】このアプリの入口は長らく音声だけで、SpeechRecognition が無い環境
// （Firefox 等）では球体を押しても「このブラウザは音声認識に対応していません」で
// 行き止まりになっていた。声を出せない場所・声で言いづらい固有名詞・音声認識の
// 誤変換など、Chrome でも文字で打ちたい場面は普通にある。
// 音声を主役のまま残し、文字を「いつでも使える横の入口」として足すのがここの役目。
// initialText は共有ページの導線から運ばれてくる問い（ChatView が ?ask= を渡す）。
// 送信まではしない。無料枠を1回使う操作を、本人が押していないうちに始めないため
const props = withDefaults(defineProps<{
  disabled?:    boolean
  placeholder?: string
  initialText?: string
  // trueの間は入力欄を認識結果の表示専用に切り替える（同じ枠を用途ごとに使い分ける）
  readonly?:    boolean
  displayText?: string
}>(), {
  disabled:    false,
  placeholder: 'メッセージを入力',
  initialText: '',
  readonly:    false,
  displayText: '',
})

const emit = defineEmits<{ send: [text: string] }>()

const text = ref(props.initialText)
const area = ref<HTMLTextAreaElement | null>(null)

const canSubmit = computed(() => !props.disabled && !props.readonly && text.value.trim().length > 0)

// readonly中はdisplayTextをそのまま映す。読み取り専用が終わったら、送信済みの認識結果を
// 引きずらないよう空に戻す（onresultのfinalText.value += と手入力が競合しないのはreadonly属性側で担保）
watch(
  () => [props.readonly, props.displayText] as const,
  ([isReadonly, display], prev) => {
    if (isReadonly) {
      text.value = display
      nextTick(autosize)
    } else if (prev?.[0]) {
      text.value = ''
      nextTick(autosize)
    }
  },
  { immediate: true }
)

// 入力量に合わせて高さを伸ばす（最大 MAX_HEIGHT でスクロールに切り替わる）。
// 一度 height を空にしてから scrollHeight を読まないと、縮む方向に追従しない。
//
// 【1行のときの縦位置】textarea は中身を垂直中央に寄せられないため、
// 上下 padding（py-1 = 4px）で挟んで合計 32px にし、隣の送信ボタン（h-8 = 32px）と
// 高さを揃えている。24px（leading-6）+ 4 + 4 = 32。
// この padding は scrollHeight に含まれるので、autosize 側で足す必要はない
const MAX_HEIGHT = 160
// ここは、テキストエリアの改行に当てる。
function autosize() {
  const el = area.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
}
// ここは取得したテキストを持ってきてautosize()で高さを指定し、sendイベントを起こす。
function submit() {
  if (!canSubmit.value) return
  const value = text.value.trim()
  text.value = ''
  nextTick(autosize)
  emit('send', value)
}

// Enter で送信、Shift+Enter で改行。
// 日本語入力では変換確定の Enter が先に来るため、変換中は絶対に送信しない。
// isComposing だけだと一部ブラウザ（旧Safari等）で立たないことがあるので、
// レガシーな keyCode 229 も併せて見る
// initialText（共有ページ由来の問い）は @input を経由せず ref へ直接入るため、
// autosize() が一度も走らないまま rows="1" 相当の高さに固定される。
// マウント後に1回だけ測り直す
onMounted(() => nextTick(autosize))

function onKeydown(e: KeyboardEvent) {
  if (props.readonly) return
  if (e.key !== 'Enter' || e.shiftKey) return
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  submit()
}
</script>

<template>
  <form
    class="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors
           border-black/10 bg-white focus-within:border-cyan-500/60
           dark:border-white/12 dark:bg-white/5 dark:focus-within:border-cyan-400/50"
    @submit.prevent="submit"
  >
    <label class="sr-only" for="text-composer">メッセージ</label>
    <textarea
      id="text-composer"
      ref="area"
      v-model="text"
      rows="1"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      class="flex-1 resize-none bg-transparent text-sm leading-6 outline-none max-h-40 min-h-8 py-1
             text-gray-900 placeholder:text-gray-400 disabled:text-gray-400
             dark:text-white/90 dark:placeholder:text-white/30 dark:disabled:text-white/30"
      @input="autosize"
      @keydown="onKeydown"
    />
    <button
      type="submit"
      class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
      :class="canSubmit
        ? 'bg-cyan-500 text-white hover:bg-cyan-400 cursor-pointer'
        : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-white/8 dark:text-white/25'"
      :disabled="!canSubmit"
      title="送信"
      aria-label="送信"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </form>
</template>
