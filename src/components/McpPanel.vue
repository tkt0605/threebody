<script setup lang="ts">
import { ref } from 'vue'
import { useSettings } from '../composables/useSettings'

defineEmits<{ close: [] }>()

const { settings } = useSettings()

const dragging = ref(false)
const files = ref<string[]>([])

function onDrop(e: DragEvent) {
  dragging.value = false
  e.preventDefault()
  const added = Array.from(e.dataTransfer?.files ?? []).map(f => f.name)
  files.value.push(...added)
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  files.value.push(...Array.from(input.files ?? []).map(f => f.name))
}

function removeFile(name: string) {
  files.value = files.value.filter(f => f !== name)
}
</script>

<template>
  <div class="flex flex-col w-full h-full bg-gray-950">
    <header class="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
      <span class="text-sm text-white/50">MCP · Files</span>
      <button
        class="text-white/30 hover:text-white/70 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </header>

    <div class="flex-1 overflow-y-auto px-6 py-6 space-y-8">

      <!-- MCP サーバー -->
      <section class="space-y-3">
        <h3 class="text-xs font-medium text-white/35 uppercase tracking-widest">MCP サーバー</h3>
        <div class="space-y-1.5">
          <label
            v-for="mcp in settings.mcpServers"
            :key="mcp.id"
            class="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/4 hover:bg-white/6 transition-colors cursor-pointer"
          >
            <span
              class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
              :class="mcp.enabled ? 'bg-emerald-400' : 'bg-white/15'"
            />
            <span class="text-sm text-white/65 flex-1">{{ mcp.label }}</span>
            <input
              type="checkbox"
              :checked="mcp.enabled"
              class="accent-indigo-500 cursor-pointer"
              @change="mcp.enabled = ($event.target as HTMLInputElement).checked"
            />
          </label>
        </div>
      </section>

      <!-- ファイル -->
      <section class="space-y-3">
        <h3 class="text-xs font-medium text-white/35 uppercase tracking-widest">ファイル</h3>

        <!-- Drop zone -->
        <label
          class="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-12 transition-colors cursor-pointer"
          :class="dragging ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-white/10 hover:border-white/20'"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop="onDrop"
        >
          <svg class="w-7 h-7 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="text-sm text-white/25">ドロップまたはクリックして追加</span>
          <input type="file" multiple class="hidden" @change="onFileInput" />
        </label>

        <!-- File list -->
        <ul v-if="files.length" class="space-y-1.5">
          <li
            v-for="f in files"
            :key="f"
            class="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/4 text-sm text-white/55 group"
          >
            <svg class="w-4 h-4 text-white/25 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke-linecap="round"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span class="flex-1 truncate">{{ f }}</span>
            <button
              class="text-white/20 hover:text-white/60 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
              @click="removeFile(f)"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </li>
        </ul>
      </section>

    </div>
  </div>
</template>
