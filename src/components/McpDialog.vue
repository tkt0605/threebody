<script setup lang="ts">
import { ref } from 'vue'
import { useSettings } from '../composables/useSettings'

const dialogRef = ref<HTMLDialogElement | null>(null)
const { settings } = useSettings()
const files = ref<string[]>([])
const dragging = ref(false)

function open() { dialogRef.value?.showModal() }
function close() { dialogRef.value?.close() }

function onDrop(e: DragEvent) {
  dragging.value = false
  e.preventDefault()
  files.value.push(...Array.from(e.dataTransfer?.files ?? []).map(f => f.name))
}
function onFileInput(e: Event) {
  files.value.push(...Array.from((e.target as HTMLInputElement).files ?? []).map(f => f.name))
}
function removeFile(name: string) {
  files.value = files.value.filter(f => f !== name)
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[480px] max-h-[75vh] rounded-2xl bg-gray-900 text-white p-0 border border-white/10 shadow-2xl flex flex-col backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col h-full">
        <header class="flex items-center justify-between px-5 py-3.5 border-b border-white/8 shrink-0">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-green-400" />
            <span class="text-sm font-medium text-white/80">MCP · Files</span>
          </div>
          <button class="text-white/30 hover:text-white/70 transition-colors cursor-pointer" @click="close">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <section class="space-y-2">
            <p class="text-xs text-white/35 uppercase tracking-widest">MCP サーバー</p>
            <div class="space-y-1.5">
              <label v-for="mcp in settings.mcpServers" :key="mcp.id"
                class="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/4 hover:bg-white/6 transition-colors cursor-pointer">
                <span class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors" :class="mcp.enabled ? 'bg-green-400' : 'bg-white/15'" />
                <span class="text-sm text-white/70 flex-1">{{ mcp.label }}</span>
                <input type="checkbox" :checked="mcp.enabled" class="accent-green-500 cursor-pointer"
                  @change="mcp.enabled = ($event.target as HTMLInputElement).checked" />
              </label>
            </div>
          </section>

          <section class="space-y-2">
            <p class="text-xs text-white/35 uppercase tracking-widest">ファイル</p>
            <label
              class="flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed py-8 transition-colors cursor-pointer"
              :class="dragging ? 'border-green-500/50 bg-green-500/5' : 'border-white/10 hover:border-white/20'"
              @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop="onDrop"
            >
              <svg class="w-6 h-6 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="text-sm text-white/25">ドロップまたはクリックして追加</span>
              <input type="file" multiple class="hidden" @change="onFileInput" />
            </label>
            <ul v-if="files.length" class="space-y-1">
              <li v-for="f in files" :key="f"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/4 text-sm text-white/55 group">
                <svg class="w-3.5 h-3.5 text-white/25 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke-linecap="round"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span class="flex-1 truncate">{{ f }}</span>
                <button class="text-white/20 hover:text-white/60 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" @click="removeFile(f)">
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
