<script setup lang="ts">
import { ref } from 'vue'

// 汎用の削除確認ダイアログ。DeleteAccountDialog の確認フロー（確認→busy→エラー表示）を
// 「確認ワード入力」抜きで軽量化したもの。会話削除・孤立ターン削除など、取り消せないが
// 全損ではない操作に使う。呼び出し側は open() に実処理（onConfirm）を渡すだけでよい
const dialogRef = ref<HTMLDialogElement | null>(null)
const busy = ref(false)
const error = ref('')
const title = ref('')
const message = ref('')
const confirmLabel = ref('削除する')

// 後で実行したい処理を入れておく箱を用意
let action: (() => Promise<void>) | null = null

// ダイヤログを開く関数
function open(opts: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => Promise<void>
}) {
  title.value = opts.title
  message.value = opts.message
  confirmLabel.value = opts.confirmLabel ?? '削除する'
  action = opts.onConfirm
  busy.value = false
  error.value = ''
  dialogRef.value?.showModal()
}

function close() {
  if (busy.value) return
  dialogRef.value?.close()
}

async function confirm() {
  if (!action || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
    dialogRef.value?.close()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作に失敗しました'
  } finally {
    busy.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[320px] max-w-[90vw] rounded-2xl p-0 shadow-2xl
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @cancel.prevent="close"
      @click.self="close"
    >
      <div class="flex flex-col gap-4 px-6 py-6">
        <div class="space-y-2">
          <h2 class="text-sm font-semibold text-rose-600 dark:text-rose-400">{{ title }}</h2>
          <p class="text-xs leading-6 text-gray-500 dark:text-white/50">{{ message }}</p>
        </div>

        <p v-if="error" role="alert" class="text-xs text-rose-500 dark:text-rose-400">{{ error }}</p>

        <div class="flex justify-end gap-2">
          <button
            class="px-4 py-2 rounded-xl text-xs font-medium transition-colors
                   text-gray-500 hover:bg-gray-200/60 disabled:opacity-40
                   dark:text-white/50 dark:hover:bg-white/8"
            :class="busy ? 'cursor-not-allowed' : 'cursor-pointer'"
            :disabled="busy"
            @click="close"
          >キャンセル</button>
          <button
            class="px-4 py-2 rounded-xl text-xs font-medium transition-colors"
            :class="busy
              ? 'bg-rose-600/20 text-rose-100/60 cursor-not-allowed dark:bg-rose-500/15 dark:text-rose-200/40'
              : 'bg-rose-600 text-white hover:bg-rose-500 cursor-pointer'"
            :disabled="busy"
            @click="confirm"
          >{{ busy ? '削除中…' : confirmLabel }}</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
