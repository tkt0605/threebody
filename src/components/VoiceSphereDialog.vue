<script setup lang="ts">
import { ref } from 'vue'
import VoiceSphere from './VoiceSphere.vue'

defineProps<{
  recording:     boolean
  bars:          number[]
  wakeListening: boolean
  confirming:    boolean
  confirmText:   string
  errorMsg?:     string | null
}>()

const emit = defineEmits<{ 'toggle-mic': []; 'confirm-send': []; redo: []; closed: [] }>()

const dialogRef = ref<HTMLDialogElement | null>(null)

function open() { dialogRef.value?.showModal() }
function close() { dialogRef.value?.close() }
function handleClose() { close(); emit('closed') }

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed inset-0 m-0 w-screen h-dvh max-w-none max-h-none p-0 rounded-none
             bg-gray-50 text-gray-900
             dark:bg-gray-950 dark:text-white
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @close="handleClose"
    >
      <div class="flex flex-col items-center h-full w-full px-6 py-8">
        <!-- 大きな球体 -->
        <div class="flex-1 flex flex-col items-center justify-center gap-6 min-h-0">
          <div class="w-64 h-64 sm:w-80 sm:h-80">
            <VoiceSphere
              :recording="recording"
              :bars="bars"
              :wake-listening="wakeListening"
              idle-label="タップして続ける"
              @click="emit('toggle-mic')"
            />
          </div>
          <!-- マイク拒否・非対応ブラウザ。出さないと「球体を押しても無反応」にしか見えない -->
          <p v-if="errorMsg" role="alert" class="text-sm text-center max-w-sm text-red-500 dark:text-red-400">
            {{ errorMsg }}
          </p>

          <!-- 認識結果の確認：誤認識のまま送らないよう、送信前に一度確認を挟む -->
          <div v-if="confirming" class="flex flex-col items-center gap-3 max-w-sm text-center">
            <p class="text-sm text-gray-700 dark:text-white/80">『{{ confirmText }}』でいいですか？</p>
            <div class="flex gap-3">
              <button
                class="px-4 py-2 rounded-full text-sm font-medium bg-cyan-500 text-white hover:bg-cyan-400 transition-colors cursor-pointer"
                @click="emit('confirm-send')"
              >送信</button>
              <button
                class="px-4 py-2 rounded-full text-sm font-medium border border-black/10 text-gray-600 hover:bg-gray-200/60
                       dark:border-white/15 dark:text-white/70 dark:hover:bg-white/8 transition-colors cursor-pointer"
                @click="emit('redo')"
              >もう一度話す</button>
            </div>
          </div>
          <p v-else class="text-xs text-gray-400 dark:text-white/35 tracking-wide">球体をタップして話しかけてください</p>
        </div>

        <!-- 閉じるボタン：球体の真下・画面最下部中央 -->
        <button
          class="shrink-0 w-11 h-11 flex items-center justify-center rounded-full transition-colors cursor-pointer
                 border border-black/8 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60
                 dark:border-white/10 dark:text-white/40 dark:hover:text-white/80 dark:hover:bg-white/8"
          title="閉じる"
          aria-label="閉じる"
          @click="close"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </dialog>
  </Teleport>
</template>
