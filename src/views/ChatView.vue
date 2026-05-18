<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import AppRightSidebar from '../components/AppRightSidebar.vue'
import MessageList from '../components/MessageList.vue'
import { useChat } from '../composables/useChat'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useTTS } from '../composables/useTTS'
import { useSettings } from '../composables/useSettings'

const { messages, sendMessage } = useChat()
const { speak } = useTTS()
const { settings } = useSettings()

const input       = ref('')
const voiceActive = ref(false)

// 音声認識完了 → 自動送信
const { recording, finalText, interimText, bars, start, stop, cancel } =
  useVoiceInput((text) => {
    input.value = ''
    voiceActive.value = true
    sendMessage(text)
  })

// 録音中はリアルタイムでサイドバーのテキストエリアに流し込む
watch([finalText, interimText], () => {
  if (recording.value) {
    input.value = finalText.value + interimText.value
  }
})

// AI応答テキスト（TTS用）
const responseText = computed(() => {
  const last = messages.value.at(-1)
  if (last?.role !== 'assistant') return ''
  const block = last.blocks.find(b => b.type === 'text')
  return block?.type === 'text' ? block.content : ''
})

// ストリーミング完了 → TTS読み上げ
watch(
  () => messages.value.at(-1)?.streaming,
  (streaming) => {
    if (voiceActive.value && streaming === false) {
      const lang = settings.language === 'ja' ? 'ja-JP' : 'en-US'
      speak(responseText.value, lang, () => { voiceActive.value = false })
    }
  }
)

function submit() {
  const text = input.value.trim()
  if (!text) return
  if (recording.value) cancel()  // 録音中なら onFinish を呼ばずに終了
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
      :bars="bars"
      @submit="submit"
      @toggle-mic="recording ? stop() : start()"
    />
  </div>
</template>
