<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SharedKeyReason } from '../composables/useCapabilities'

// 個人枠（limit_reached）と全体枠（global_limit_reached）で文言を出し分ける。
// 既定は個人枠側にしておく（このダイアログは canRecord が false のときにだけ開き、
// その到達経路は実質この2つに絞られる）
const props = defineProps<{ reason?: SharedKeyReason | undefined }>()
const emit = defineEmits<{ 'open-settings': [] }>()

const isGlobal = computed(() => props.reason === 'global_limit_reached')

const heading = computed(() => isGlobal.value
  ? '今日はみんなの無料枠がいっぱいだよ'
  : '今日の無料分を使い切ったよ')

const subtext = computed(() => isGlobal.value
  ? '本日ぶんのお試し枠が終了しました。明日また使えます。今すぐ使うなら設定から自分のAPIキーを登録してね。'
  : '明日また無料枠が使えます。続けて使うなら設定から自分のAPIキーを登録してね。')

const dialogRef = ref<HTMLDialogElement | null>(null)

function open() { dialogRef.value?.showModal() }
function close() { dialogRef.value?.close() }

function openSettings() {
  close()
  emit('open-settings')
}

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[320px] rounded-2xl p-0 shadow-2xl
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col items-center gap-3 px-6 py-6 text-center">
        <p class="text-sm font-medium text-gray-700 dark:text-white/80">{{ heading }}</p>
        <p class="text-xs text-gray-400 dark:text-white/40">{{ subtext }}</p>
        <div class="flex gap-2 mt-1">
          <button
            class="px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer
                   bg-indigo-600/12 text-indigo-600 hover:bg-indigo-600/20
                   dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
            @click="openSettings"
          >設定を開く</button>
          <button
            class="px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer
                   text-gray-500 hover:bg-gray-200/60
                   dark:text-white/50 dark:hover:bg-white/8"
            @click="close"
          >閉じる</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
