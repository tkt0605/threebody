<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'
import EmptyBrainState from '../components/EmptyBrainState.vue'
import VoiceSphere from '../components/VoiceSphere.vue'
import VoiceSphereDialog from '../components/VoiceSphereDialog.vue'
import MessageList from '../components/MessageList.vue'
import { useChat } from '../composables/useChat'
import { useVoiceInput } from '../composables/useVoiceInput'
import { useWakeWord } from '../composables/useWakeWord'
import { useTTS } from '../composables/useTTS'
import { useSettings } from '../composables/useSettings'
import { useAsideDrawer } from '../composables/useAsideDrawer'
import type { Message } from '../types/message'

const { messages, sendMessage, loadHistory, aiState } = useChat()
const { speak } = useTTS()
const { settings } = useSettings()
const { openAside } = useAsideDrawer()

onMounted(() => {
  loadHistory()
})

const voiceActive = ref(false)

const voiceDialog = ref<InstanceType<typeof VoiceSphereDialog> | null>(null)

// 履歴が空の状態から中央の球体で最初の発話をした場合、思考（thinking）が終わって
// 一体に収束するまではチャットログへ画面遷移させず、中央の球体画面のままにする
const firstExchangeInFlight = ref(false)

// APIキー・モデルが設定済み（≒会話可能）な体が1つ以上あるか
const hasActiveBody = computed(() =>
  settings.bodies.some(b =>
    b.model.trim().length > 0 && (b.provider === 'ollama' || b.apiKey.trim().length > 0)
  )
)

// 音声認識完了 → 自動送信
const { recording, finalText, interimText, bars, start, stop } =
  useVoiceInput((text) => {
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
    if (messages.value.length === 0) firstExchangeInFlight.value = true
  }
})

// 音声インタラクション終了後にウェイクワード待機を再開（初回操作済みの場合のみ）
watch(voiceActive, (active) => {
  if (!active && !recording.value && micEverUsed.value) startListening()
})

// 会話継続ダイアログは録音中・thinking中（２〜３体が並列で考えている間）は開いたままにし、
// 副体の見解が出揃って一体（主体）に収束した瞬間（thinking を抜けた瞬間）に自動で閉じて会話ログへ戻す。
// 中央の球体からの最初の発話も同様に、収束の瞬間までチャットログへの画面遷移を遅らせる
watch(aiState, (state, prevState) => {
  if (prevState === 'thinking' && state !== 'thinking') {
    voiceDialog.value?.close()
    firstExchangeInFlight.value = false
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

</script>

<template>
  <div class="flex flex-col h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <AppHeader />

    <main class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <!-- APIキー・モデル未設定：脳みそがまだない -->
      <div v-if="!hasActiveBody" class="flex-1 flex items-center justify-center">
        <EmptyBrainState @open-settings="openAside" />
      </div>

      <!-- 設定済み・会話なし（最初の発話が思考中の場合も含む）：中央に大きな球体 -->
      <div v-else-if="messages.length === 0 || firstExchangeInFlight" class="flex-1 flex items-center justify-center px-6">
        <div class="w-56 h-56 sm:w-72 sm:h-72">
          <VoiceSphere
            :recording="recording"
            :bars="bars"
            :wake-listening="wakeListening"
            @click="recording ? stop() : start()"
          />
        </div>
      </div>

      <!-- 会話中：メッセージ一覧 + 下部に小さな球体（タップで会話継続ダイアログ） -->
      <template v-else>
        <MessageList class="flex-1 min-h-0" :messages="messages" :draft-message="draftMessage" />
        <div class="shrink-0 flex items-center justify-center py-3 border-t border-black/8 dark:border-white/8">
          <div
            class="w-14 h-14 rounded-full overflow-hidden cursor-pointer transition-transform hover:scale-105"
            title="続けて話す"
            @click="voiceDialog?.open()"
          >
            <VoiceSphere
              :recording="recording"
              :bars="bars"
              :wake-listening="wakeListening"
              :show-status="false"
            />
          </div>
        </div>
      </template>
    </main>

    <AppAside />

    <VoiceSphereDialog
      ref="voiceDialog"
      :recording="recording"
      :bars="bars"
      :wake-listening="wakeListening"
      @toggle-mic="recording ? stop() : start()"
    />
  </div>
</template>
