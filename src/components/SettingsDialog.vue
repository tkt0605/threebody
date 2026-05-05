<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useSettings, type Language } from '../composables/useSettings'

const { settings } = useSettings()

const dialogRef = ref<HTMLDialogElement | null>(null)

// 編集中のローカルコピー
const draft = reactive({
  language: settings.language,
  systemPrompt: settings.systemPrompt,
  mcpServers: settings.mcpServers.map(s => ({ ...s })),
})

function open() {
  draft.language = settings.language
  draft.systemPrompt = settings.systemPrompt
  draft.mcpServers = settings.mcpServers.map(s => ({ ...s }))
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
}

function save() {
  settings.language = draft.language
  settings.systemPrompt = draft.systemPrompt
  settings.mcpServers.forEach((s, i) => {
    s.enabled = draft.mcpServers[i]?.enabled ?? s.enabled
  })
  close()
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[480px] rounded-2xl bg-gray-900 text-white p-0 border border-white/10 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-white/8">
            <h2 class="text-sm font-semibold text-white/90">設定</h2>
            <button class="text-white/40 hover:text-white/80 transition-colors cursor-pointer" @click="close">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="px-6 py-5 space-y-6">

            <!-- 言語 -->
            <div class="space-y-2">
              <label class="text-xs font-medium text-white/50 uppercase tracking-widest">言語</label>
              <div class="flex gap-2">
              <button
                v-for="opt in ([{ value: 'ja', label: '日本語' }, { value: 'en', label: 'English' }] as { value: Language; label: string }[])"
                :key="opt.value"
                class="px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer"
                :class="draft.language === opt.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/6 text-white/50 hover:text-white/80 hover:bg-white/10'"
                @click="draft.language = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- システムプロンプト -->
          <div class="space-y-2">
            <label class="text-xs font-medium text-white/50 uppercase tracking-widest">システムプロンプト</label>
            <textarea
              v-model="draft.systemPrompt"
              rows="5"
              placeholder="AIの根本的な振る舞いを定義してください..."
              class="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder-white/20 px-4 py-3 outline-none resize-none focus:border-white/20 transition-colors leading-relaxed"
            />
          </div>

          <!-- MCP -->
          <!-- <div class="space-y-2">
            <label class="text-xs font-medium text-white/50 uppercase tracking-widest">MCP サーバー</label>
            <div class="space-y-1.5">
              <label
                v-for="(mcp, i) in draft.mcpServers"
                :key="mcp.id"
                class="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/4 hover:bg-white/7 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="mcp.enabled"
                  class="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                  @change="draft.mcpServers[i]!.enabled = ($event.target as HTMLInputElement).checked"
                />
                <span class="text-sm text-white/75">{{ mcp.label }}</span>
              </label>
            </div>
          </div> -->
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-white/8">
          <button
            class="px-4 py-2 rounded-xl text-sm text-white/50 hover:text-white/80 hover:bg-white/6 transition-colors cursor-pointer"
            @click="close"
          >
            キャンセル
          </button>
          <button
            class="px-4 py-2 rounded-xl text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
            @click="save"
          >
            保存
          </button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
