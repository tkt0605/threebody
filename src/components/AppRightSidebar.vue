<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import McpDialog from './McpDialog.vue'
import ContextDialog from './ContextDialog.vue'

const props = defineProps<{
  recording: boolean
  bars: number[]
  input: string
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  'toggle-mic': []
  'open-mcp': []
  'open-context': []
}>()

const mcpRef = ref<InstanceType<typeof McpDialog> | null>(null)
const ctxRef = ref<InstanceType<typeof ContextDialog> | null>(null)

const recordingMessages = ['ふむふむ、聞いてるよ...', 'なるほど！', 'もっと続けて...', '考え中...']
const messageIdx = ref(0)
let messageTimer: ReturnType<typeof setInterval> | null = null

watch(() => props.recording, (val) => {
  if (val) {
    messageTimer = setInterval(() => {
      messageIdx.value = (messageIdx.value + 1) % recordingMessages.length
    }, 2000)
  } else {
    if (messageTimer) {
      clearInterval(messageTimer)
      messageTimer = null
    }
    messageIdx.value = 0
  }
})

onUnmounted(() => {
  if (messageTimer) clearInterval(messageTimer)
})

const statusText = computed(() =>
  props.recording ? recordingMessages[messageIdx.value] : '話しかけてみて'
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <aside class="flex flex-col w-72 h-screen border-l border-black/8 dark:border-white/8 shrink-0 bg-gray-50 dark:bg-gray-950">
    <!-- ヘッダー -->
    <div class="flex items-center gap-2 px-5 py-5.5 border-b border-black/8 dark:border-white/8">
      <svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="text-sm font-semibold text-gray-900 dark:text-white/90">プロンプト入力</span>
    </div>

    <!-- 音声認識UI -->
    <div class="flex flex-col items-center gap-5 px-5 py-8 border-b border-black/8 dark:border-white/8">

      <!-- シナプス連鎖 -->
      <div class="flex items-center gap-1.5">
        <div
          v-for="i in 12"
          :key="i"
          class="synapse-dot w-1.5 h-1.5 rounded-full"
          :class="recording ? 'bg-indigo-400' : 'bg-gray-300 dark:bg-white/20'"
          :style="{
            animationDuration: recording ? '0.85s' : '2.4s',
            animationDelay: `${(i - 1) * (recording ? 0.07 : 0.2)}s`,
          }"
        />
      </div>

      <!-- マイクボタン + エフェクト -->
      <div class="relative flex items-center justify-center w-24 h-24">

        <!-- パルスリング（録音中） -->
        <template v-if="recording">
          <div class="absolute inset-0 rounded-full border-2 border-rose-400/70 pulse-ring" />
          <div class="absolute inset-0 rounded-full border-2 border-rose-400/40 pulse-ring" style="animation-delay: 0.65s" />
        </template>

        <!-- 周回ドット（待機中） -->
        <template v-else>
          <div
            v-for="i in 5"
            :key="i"
            class="orbit-dot absolute w-2 h-2 rounded-full bg-indigo-300 dark:bg-indigo-400/60"
            :style="{ '--i': i - 1, top: 'calc(50% - 4px)', left: 'calc(50% - 4px)' }"
          />
        </template>

        <!-- メインボタン -->
        <button
          class="relative z-10 w-14 h-14 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg"
          :class="recording
            ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/40'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/40'"
          :title="recording ? '停止' : '音声入力を開始'"
          @click="emit('toggle-mic')"
        >
          <svg v-if="!recording" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="9" y="2" width="6" height="13" rx="3"/>
            <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        </button>
      </div>

      <!-- ステータステキスト（スライド切替） -->
      <Transition name="status" mode="out-in">
        <p :key="statusText" class="text-xs font-medium text-indigo-500 dark:text-indigo-400">
          {{ statusText }}
        </p>
      </Transition>
    </div>

    <!-- テキスト入力エリア（下部固定） -->
    <div class="flex flex-col flex-1 justify-end px-3 py-4 gap-3">
      <div
        class="flex flex-col gap-2 rounded-2xl border px-4 py-3 transition-colors
               bg-white border-black/10 focus-within:border-indigo-400/60
               dark:bg-white/5 dark:border-white/10 dark:focus-within:border-indigo-400/40"
      >
        <textarea
          :value="input"
          rows="3"
          placeholder="メッセージを入力..."
          class="w-full resize-none bg-transparent text-sm outline-none leading-relaxed
                 text-gray-900 placeholder-black/30
                 dark:text-white/90 dark:placeholder-white/25"
          @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)"
          @keydown="onKeydown"
        />

        <!-- 送信ボタン -->
        <div class="flex justify-end pt-1 border-t border-black/6 dark:border-white/6">
          <button
            :disabled="!input.trim()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
            :class="input.trim()
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
              : 'bg-black/6 dark:bg-white/6 text-gray-400 dark:text-white/25 cursor-default'"
            @click="emit('submit')"
          >
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            送信
          </button>
        </div>
      </div>

      <p class="text-[11px] text-gray-400 dark:text-white/25 px-1">
        <kbd class="font-mono">Enter</kbd> で送信　<kbd class="font-mono">Shift+Enter</kbd> で改行
      </p>
    </div>
  </aside>

  <McpDialog ref="mcpRef" />
  <ContextDialog ref="ctxRef" />
</template>

<style scoped>
/* シナプス伝播 */
@keyframes synapse {
  0%, 100% { opacity: 0.25; transform: scale(1); }
  50%       { opacity: 1;    transform: scale(1.6); }
}

.synapse-dot {
  animation: synapse ease-in-out infinite;
}

/* 周回ドット */
@keyframes orbit {
  from { transform: rotate(0deg)   translateX(36px); }
  to   { transform: rotate(360deg) translateX(36px); }
}

.orbit-dot {
  animation: orbit 5s linear infinite;
  animation-delay: calc(var(--i) * -1s);
}

/* パルスリング */
@keyframes pulse-ring {
  0%   { transform: scale(1);   opacity: 0.8; }
  100% { transform: scale(1.8); opacity: 0;   }
}

.pulse-ring {
  animation: pulse-ring 1.6s ease-out infinite;
}

/* ステータステキストのスライドフェード */
.status-enter-active,
.status-leave-active {
  transition: opacity 0.22s, transform 0.22s;
}
.status-enter-from { opacity: 0; transform: translateY(6px); }
.status-leave-to   { opacity: 0; transform: translateY(-6px); }
</style>
