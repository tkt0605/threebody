<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import AppRightSidebar from '../components/AppRightSidebar.vue'
import MessageList from '../components/MessageList.vue'
import VoiceOverlay from '../components/VoiceOverlay.vue'
import { useChat } from '../composables/useChat'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useTTS } from '../composables/useTTS'
import { useSettings } from '../composables/useSettings'

const { messages, sendMessage } = useChat()
const { speak, cancel: cancelTTS, speaking: ttsSpeaking } = useTTS()
const { settings } = useSettings()

const input       = ref('')
const voiceActive = ref(false)

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
    </div>

    <AppRightSidebar
      v-model:input="input"
      :recording="recording"
      @submit="submit"
      @toggle-mic="recording ? stop() : start()"
    />
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
</template>
