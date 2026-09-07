<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useConversationBrief, closeNote } from '../composables/useConversationBrief'
import { briefFields, briefFieldLimits, MAX_BRIEF_FILE_BYTES, progressLabels, hasBriefContent, briefConsultation, briefMarkdown, parseBriefMarkdown, mergeBrief, NOTE_TITLE } from '../lib/conversationBrief'

// 会話の目的・決定・仮説を本人が書き留めるノート。開閉は useConversationBrief の
// noteOpen（singleton）で、AppAside / AppHeader の「bodyノート」から開く。
// ノートの操作だけではモデルを呼ばない。相談文は入力欄へ足すだけで、送るのは本人
const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ prepare: [text: string] }>()
const { brief, noteOpen } = useConversationBrief()
const hasContent = computed(() => hasBriefContent(brief.value))

const dialogRef = ref<HTMLDialogElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const notice = ref('')

watchEffect(() => {
  const dialog = dialogRef.value
  if (!dialog) return
  if (noteOpen.value && !dialog.open) dialog.showModal()
  if (!noteOpen.value && dialog.open) dialog.close()
}, { flush: 'post' })

let importSequence = 0
watch([brief, noteOpen], () => {
  importSequence++
  notice.value = ''
}, { flush: 'sync' })
onUnmounted(() => {
  importSequence++
  closeNote()
})

// Esc やバックドロップで閉じたときも singleton を戻す（次に開けなくなる）
function handleClose(): void {
  // ネイティブcloseイベントは遅れて届く。既に再度開いた場合は閉じ直さない。
  if (dialogRef.value?.open) return
  notice.value = ''
  closeNote()
}

function download(): void {
  const url = URL.createObjectURL(new Blob([briefMarkdown(brief.value)], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  // 名前をつけて保存したい。
  link.download = 'threebody-note.md'
  link.click()
  const revoke = URL.revokeObjectURL.bind(URL)
  setTimeout(() => revoke(url), 1000)
}

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const sequence = ++importSequence
  const target = brief.value
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    notice.value = 'Markdown（.md / .markdown）かテキスト（.txt）を選んでください'
    return
  }
  if (file.size > MAX_BRIEF_FILE_BYTES) {
    notice.value = `${file.name} は大きすぎます（512KBまで）`
    return
  }
  try {
    const text = await file.text()
    if (sequence !== importSequence || target !== brief.value) return
    const patch = parseBriefMarkdown(text)
    mergeBrief(target, patch)
    const filled: string[] = briefFields.filter(f => patch[f.key]).map(f => f.label)
    if (patch.progress) filled.push('進捗')
    notice.value = filled.length ? `${file.name} を読み込みました（${filled.join(' / ')}）` : `${file.name} に読み込める本文がありませんでした`
  } catch (error) {
    if (sequence !== importSequence || target !== brief.value) return
    notice.value = error instanceof Error ? error.message : `${file.name} を読み込めませんでした`
  }
}

async function prepare(): Promise<void> {
  if (props.busy || !hasContent.value) return
  const target = brief.value
  const text = briefConsultation(target)
  closeNote()
  // modal中は背後の入力欄がinert。閉じてから追加・フォーカスする。
  await nextTick()
  if (!props.busy && target === brief.value) emit('prepare', text)
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      aria-labelledby="brief-dialog-title"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[640px] max-w-[92vw] rounded-2xl p-0 shadow-2xl
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @close="handleClose"
      @click.self="closeNote"
    >
      <div class="flex flex-col max-h-[90dvh]">
        <div class="flex items-center justify-between px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0">
          <h2 id="brief-dialog-title" class="text-sm font-semibold text-gray-900 dark:text-white/90">
            {{ NOTE_TITLE }}
            <span class="ml-3 text-xs font-normal text-gray-500 dark:text-white/50">{{ progressLabels[brief.progress] }} · 任意</span>
          </h2>
          <button
            class="transition-colors cursor-pointer text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/80"
            aria-label="閉じる"
            @click="closeNote"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div class="px-6 py-5 space-y-4 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full">
          <p class="text-xs text-gray-500 dark:text-white/50">この会話の目的と、今わかっていること。再読み込みで消えるため、残したい内容はMarkdownで保存してください。</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <label
              v-for="field in briefFields" :key="field.key"
              class="space-y-1 text-xs font-medium"
              :class="field.key === 'material' ? 'sm:col-span-2' : ''"
            >
              <span>{{ field.label }}</span>
              <textarea
                v-model="brief[field.key]"
                :placeholder="field.placeholder"
                :aria-label="field.label"
                :maxlength="briefFieldLimits[field.key]"
                :rows="field.key === 'material' ? 4 : 2"
                class="block w-full resize-y rounded-xl border border-black/8 bg-gray-50 p-2 text-sm font-normal outline-none focus:border-black/20
                       dark:border-white/8 dark:bg-white/5 dark:focus:border-white/20"
              />
            </label>
          </div>
          <label class="flex items-center gap-3 text-xs">
            進捗（自分で判断）
            <select
              v-model="brief.progress"
              class="rounded-xl border border-black/8 bg-gray-50 px-3 py-2 text-sm outline-none dark:border-white/8 dark:bg-white/5"
            >
              <option v-for="(label, key) in progressLabels" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <p v-if="notice" role="status" class="text-xs text-gray-500 dark:text-white/50">{{ notice }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2 px-6 py-4 border-t border-black/8 dark:border-white/8 shrink-0">
          <button
            type="button"
            class="rounded-xl border border-black/10 px-3 py-2 text-xs transition-colors cursor-pointer hover:bg-gray-200/60 dark:border-white/10 dark:hover:bg-white/8"
            @click="fileInput?.click()"
          >ファイル添付</button>
          <input
            ref="fileInput"
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            class="hidden"
            aria-label="Markdown・テキストファイルを読み込む"
            @change="importFile"
          >
          <button
            type="button"
            :disabled="!hasContent"
            class="rounded-xl border border-black/10 px-3 py-2 text-xs transition-colors cursor-pointer hover:bg-gray-200/60 disabled:opacity-40 disabled:cursor-not-allowed dark:border-white/10 dark:hover:bg-white/8"
            @click="download"
          >ダウンロード</button>
          <button
            type="button"
            :disabled="busy || !hasContent"
            class="ml-auto rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
            @click="prepare"
          >入力欄に追加</button>
        </div>
        <p class="px-6 pb-4 text-[11px] text-gray-400 dark:text-white/35">追加後に編集して送信できます。送るまではAIに渡りません。音声の発話には自動で付きません。</p>
      </div>
    </dialog>
  </Teleport>
</template>
