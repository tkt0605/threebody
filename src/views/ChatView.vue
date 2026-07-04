<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import AppRightSidebar from '../components/AppRightSidebar.vue'
import MessageList from '../components/MessageList.vue'
import { useChat } from '../composables/useChat'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useWakeWord } from '../composables/useWakeWord'
import { useTTS } from '../composables/useTTS'
import { useSettings } from '../composables/useSettings'
import type { Message } from '../types/message'

const { messages, sendMessage, loadHistory } = useChat()
const { speak } = useTTS()
const { settings } = useSettings()

onMounted(() => {
  loadHistory()
})

const input       = ref('')
const voiceActive = ref(false)

// 音声認識完了 → 自動送信
const { recording, finalText, interimText, bars, start, stop, cancel } =
  useVoiceInput((text) => {
    input.value = ''
    voiceActive.value = true
    sendMessage(text)
  })

// 「アイリス」でウェイク → 録音開始
const { listening: wakeListening, startListening, stopListening } = useWakeWord(() => {
  start()
})

// ユーザーが一度でも明示的にマイクを使ったかどうか
const micEverUsed = ref(false)

// 録音中はウェイクワード検知を停止（同一マイクの競合を防ぐ）
watch(recording, (isRec) => {
  if (isRec) {
    micEverUsed.value = true
    stopListening()
  }
})

// 音声インタラクション終了後にウェイクワード待機を再開（初回操作済みの場合のみ）
watch(voiceActive, (active) => {
  if (!active && !recording.value && micEverUsed.value) startListening()
})

// 録音中はリアルタイムでサイドバーのテキストエリアに流し込む
watch([finalText, interimText], () => {
  if (recording.value) {
    input.value = finalText.value + interimText.value
  }
})

// 録音中の音声認識結果を「あなた」の発言としてリアルタイムにメッセージ一覧へ表示
const draftMessage = computed<Message | null>(() => {
  if (!recording.value) return null
  return {
    id: 'draft',
    role: 'user',
    blocks: [{ type: 'text', content: finalText.value + interimText.value }],
    timestamp: new Date(),
    streaming: true,
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
  voiceActive.value = false; // 送信ボタンで音声モードを終了（OFF）にする。
  const text = input.value.trim()
  if (!text) return
  if (recording.value) {
    cancel()  // 録音中なら onFinish を呼ばずに終了
    micEverUsed.value = true
  }
  sendMessage(text)
  input.value = ''
}


</script>

<template>
  <div class="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <AppAside />

    <div class="flex flex-col flex-1 min-w-0">
      <AppHeader />

      <!-- メッセージ一覧 -->
      <MessageList :messages="messages" :draft-message="draftMessage" />
    </div>

    <AppRightSidebar
      v-model:input="input"
      :recording="recording"
      :bars="bars"
      :wake-listening="wakeListening"
      @submit="submit"
      @toggle-mic="recording ? stop() : start()"
    />
  </div>
</template>
