<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuth } from '../composables/useAuth'

// 退会の確認ダイアログ。
//
// 【なぜ確認を二重にするか】この操作だけは取り消せない。会話の削除（1件消えるだけ）と
// 同じ「本当に削除しますか？」で流せると、押し間違いがそのまま全損になる。
// 「削除」と打ってもらうのは、指が滑って通過することが構造的に起きないようにするため。
const CONFIRM_WORD = '削除'

const emit = defineEmits<{ deleted: [] }>()

const { deleteAccount } = useAuth()

const dialogRef = ref<HTMLDialogElement | null>(null)
const typed     = ref('')
const busy      = ref(false)
const error     = ref('')

const canDelete = computed(() => typed.value.trim() === CONFIRM_WORD && !busy.value)

function open() {
  typed.value = ''
  error.value = ''
  busy.value  = false
  dialogRef.value?.showModal()
}

function close() {
  // 削除の実行中に閉じさせない。閉じても処理は走り続けるので、
  // ユーザーからは「押したのに何も起きていない」ようにしか見えなくなる
  if (busy.value) return
  dialogRef.value?.close()
}

async function confirm() {
  if (!canDelete.value) return
  busy.value  = true
  error.value = ''
  try {
    await deleteAccount()
    dialogRef.value?.close()
    emit('deleted')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'アカウントの削除に失敗しました'
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
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[360px] max-w-[90vw] rounded-2xl p-0 shadow-2xl
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @cancel.prevent="close"
      @click.self="close"
    >
      <div class="flex flex-col gap-4 px-6 py-6">
        <div class="space-y-2">
          <h2 class="text-sm font-semibold text-rose-600 dark:text-rose-400">アカウントを削除</h2>
          <p class="text-xs leading-6 text-gray-500 dark:text-white/50">
            アカウントと、これまでのすべての会話・メッセージ・エラー報告が完全に削除されます。
            <span class="text-gray-700 dark:text-white/75">この操作は取り消せません。</span>
          </p>
        </div>

        <label class="block space-y-1.5">
          <span class="text-xs text-gray-500 dark:text-white/45">
            続けるには「{{ CONFIRM_WORD }}」と入力してください
          </span>
          <input
            v-model="typed"
            type="text"
            :placeholder="CONFIRM_WORD"
            :disabled="busy"
            class="w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors
                   border-black/10 bg-white text-gray-900 placeholder:text-gray-300 focus:border-rose-500/60
                   dark:border-white/12 dark:bg-white/5 dark:text-white/90 dark:placeholder:text-white/20 dark:focus:border-rose-400/50"
            @keydown.enter.prevent="confirm"
          />
        </label>

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
            :class="canDelete
              ? 'bg-rose-600 text-white hover:bg-rose-500 cursor-pointer'
              : 'bg-rose-600/20 text-rose-100/60 cursor-not-allowed dark:bg-rose-500/15 dark:text-rose-200/40'"
            :disabled="!canDelete"
            @click="confirm"
          >{{ busy ? '削除中…' : '完全に削除する' }}</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
