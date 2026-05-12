<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import MessageList from '../components/MessageList.vue'
import VoiceOverlay from '../components/VoiceOverlay.vue'
import McpDialog from '../components/McpDialog.vue'
import ContextDialog from '../components/ContextDialog.vue'
import { useChat } from '../composables/useChat'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useTTS } from '../composables/useTTS'
import { useSettings } from '../composables/useSettings'

const { messages, sendMessage } = useChat()
const { speak, cancel: cancelTTS, speaking: ttsSpeaking } = useTTS()
const { settings } = useSettings()

const input       = ref('')
const voiceActive = ref(false)
const mcpRef      = ref<InstanceType<typeof McpDialog> | null>(null)
const ctxRef      = ref<InstanceType<typeof ContextDialog> | null>(null)

// 音声認識完了 → 自動送信
const { recording, finalText, interimText, bars, errorMsg, BAR_COUNT, start, stop } =
  useVoiceInput((text) => {
    voiceActive.value = true
    sendMessage(text)
  })

// AI応答テキスト
const responseText = computed(() => {
  const last = messages.value.at(-1)
  if (last?.role !== 'assistant') return ''
  const block = last.blocks.find(b => b.type === 'text')
  return block?.type === 'text' ? block.content : ''
})
const responseStreaming = computed(() => messages.value.at(-1)?.streaming === true)

// ストリーミング完了 → TTS読み上げ
watch(
  () => messages.value.at(-1)?.streaming,
  (streaming) => {
    if (voiceActive.value && streaming === false) {
      const lang = settings.language === 'ja' ? 'ja-JP' : 'en-US'
      speak(responseText.value, lang, () => {
        setTimeout(() => { voiceActive.value = false }, 600)
      })
    }
  }
)

function onDismiss() {
  cancelTTS()
  voiceActive.value = false
}

function submit() {
  const text = input.value.trim()
  if (!text) return
  sendMessage(text)
  input.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <AppAside />

    <div class="flex flex-col flex-1 min-w-0">
      <AppHeader />

      <!-- メッセージ一覧 -->
      <MessageList :messages="messages" />

      <!-- 入力エリア -->
      <div class="shrink-0 px-4 py-4 border-t border-black/8 dark:border-white/8">
        <div
          class="flex items-end gap-2 rounded-2xl border px-4 py-3 transition-colors
                 bg-white border-black/10 focus-within:border-black/20
                 dark:bg-white/5 dark:border-white/10 dark:focus-within:border-white/20"
        >
          <textarea
            v-model="input"
            rows="1"
            placeholder="メッセージを入力..."
            class="flex-1 resize-none bg-transparent text-sm outline-none max-h-32 leading-relaxed
                   text-gray-900 placeholder-black/30
                   dark:text-white/90 dark:placeholder-white/25"
            style="field-sizing: content"
            @keydown="onKeydown"
          />

          <div class="flex items-center gap-1 shrink-0">
            <!-- MCP -->
            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     dark:text-white/30 dark:hover:text-white/70 dark:hover:bg-white/8"
              title="MCPサーバー"
              @click="mcpRef?.open()"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- コンテキスト -->
            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     dark:text-white/30 dark:hover:text-white/70 dark:hover:bg-white/8"
              title="コンテキストを追加"
              @click="ctxRef?.open()"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- マイク -->
            <button
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer"
              :class="recording
                ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-white/30 dark:hover:text-white/70 dark:hover:bg-white/8'"
              title="音声入力"
              @click="recording ? stop() : start()"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="9" y="2" width="6" height="13" rx="3"/>
                <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- 送信 -->
            <button
              :disabled="!input.trim()"
              class="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              :class="input.trim()
                ? 'bg-indigo-600 hover:bg-indigo-500 cursor-pointer'
                : 'bg-black/6 dark:bg-white/6 cursor-default'"
              @click="submit"
            >
              <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <VoiceOverlay
    :recording="recording"
    :bars="bars"
    :bar-count="BAR_COUNT"
    :final-text="finalText"
    :interim-text="interimText"
    :error-msg="errorMsg"
    :voice-active="voiceActive"
    :response-text="responseText"
    :response-streaming="responseStreaming"
    :tts-speaking="ttsSpeaking"
    @stop="stop"
    @dismiss="onDismiss"
  />

  <McpDialog     ref="mcpRef" />
  <ContextDialog ref="ctxRef" />
</template>
