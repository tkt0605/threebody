<script setup lang="ts">
import { ref, reactive } from 'vue'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000'

type Mode = 'url' | 'text'

interface SceneItem {
  index:   number
  title:   string
  excerpt: string
  mood:    '情景' | '心情' | '対話'
  summary: string
}

interface ScenesResult {
  workTitle: string
  scenes:    SceneItem[]
}
const dialogRef = ref<HTMLDialogElement | null>(null)
const mode = ref<Mode>('url')
const urlInput = ref('')
const textInput = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const result = reactive<{ data: ScenesResult | null }>({ data: null})
const MOOD_STYLE: Record<string, string> = {
  '情景': 'bg-sky-500/15 text-sky-400',
  '心情': 'bg-purple-500/15 text-purple-400',
  '対話': 'bg-emerald-500/15 text-emerald-400',
}
function open() { dialogRef.value?.showModal() }
function close() { dialogRef.value?.close() }

async function generate() {
  const body = mode.value === 'url'
    ? { url: urlInput.value.trim() }
    : { text: textInput.value.trim() }
  if (!body.url && !body.text) return
  loading.value = true
  error.value = null
  result.data = null
  try{
    const response = await fetch(`${API_BASE}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json();
    if (!response.ok){
      error.value = data.error || "不明なエラーが発生";
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    result.data = data;
  }catch(err){
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[560px] max-h-[88vh] rounded-2xl p-0 shadow-2xl flex flex-col
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col h-full min-h-0">

        <!-- Header -->
        <header class="flex items-center justify-between px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">映像化コンテキスト</h2>
          </div>
          <button
            class="transition-colors cursor-pointer text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/80"
            @click="close"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </header>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">

          <!-- Mode tabs -->
          <div class="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-white/5">
            <button
              v-for="(label, key) in { url: '青空文庫 URL', text: 'テキスト貼り付け' }"
              :key="key"
              class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
              :class="mode === key
                ? 'bg-white dark:bg-white/12 text-gray-900 dark:text-white/90 shadow-sm'
                : 'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70'"
              @click="mode = key as Mode"
            >{{ label }}</button>
          </div>

          <!-- URL mode -->
          <div v-if="mode === 'url'" class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">
              青空文庫 URL
            </label>
            <input
              v-model="urlInput"
              type="url"
              placeholder="https://www.aozora.gr.jp/cards/..."
              class="w-full rounded-xl text-sm px-4 py-2.5 outline-none transition-colors
                     bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-indigo-400
                     dark:bg-white/5 dark:border-white/8 dark:text-white/90 dark:placeholder-white/20 dark:focus:border-indigo-500"
              @keydown.enter="generate"
            />
          </div>

          <!-- Text mode -->
          <div v-else class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">
              テキスト
            </label>
            <textarea
              v-model="textInput"
              rows="7"
              placeholder="文学テキストを貼り付けてください..."
              class="w-full rounded-xl text-sm px-4 py-3 outline-none resize-none leading-relaxed transition-colors
                     bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-indigo-400
                     dark:bg-white/5 dark:border-white/8 dark:text-white/90 dark:placeholder-white/20 dark:focus:border-indigo-500"
            />
          </div>

          <!-- Error -->
          <div v-if="error" class="rounded-xl px-4 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm">
            {{ error }}
          </div>

          <!-- Loading -->
          <div v-if="loading" class="flex items-center gap-3 py-4 text-sm text-gray-400 dark:text-white/40">
            <svg class="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" stroke-linecap="round"/>
            </svg>
            シーンを生成しています...
          </div>

          <!-- Scene list -->
          <div v-if="result.data" class="space-y-3">
            <div class="flex items-baseline justify-between">
              <p class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">
                {{ result.data.workTitle || 'シーンリスト' }}
              </p>
              <span class="text-xs text-gray-400 dark:text-white/30">{{ result.data.scenes.length }} シーン</span>
            </div>

            <div
              v-for="scene in result.data.scenes"
              :key="scene.index"
              class="rounded-xl border border-black/8 dark:border-white/8 p-4 space-y-2 hover:border-indigo-500/30 transition-colors"
            >
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400 dark:text-white/30 w-5 text-right shrink-0">{{ scene.index }}</span>
                <span
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0"
                  :class="MOOD_STYLE[scene.mood] ?? 'bg-gray-500/15 text-gray-400'"
                >{{ scene.mood }}</span>
                <span class="text-sm font-medium text-gray-900 dark:text-white/85 truncate">{{ scene.title }}</span>
              </div>
              <p class="text-xs text-gray-500 dark:text-white/45 leading-relaxed pl-7 italic">
                「{{ scene.excerpt }}」
              </p>
              <p class="text-xs text-gray-600 dark:text-white/55 leading-relaxed pl-7">
                {{ scene.summary }}
              </p>
            </div>
          </div>
        </div>
        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-black/8 dark:border-white/8 shrink-0">
          <button
            class="px-4 py-2 rounded-xl text-sm transition-colors cursor-pointer
                   text-gray-500 hover:text-gray-800 hover:bg-gray-100
                   dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/6"
            @click="close"
          >
            閉じる
          </button>
          <button
            class="px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer
                   bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="loading || (mode === 'url' ? !urlInput.trim() : !textInput.trim())"
            @click="generate"
          >
            {{ loading ? '生成中...' : 'シーンを生成' }}
          </button>
        </div>

      </div>
    </dialog>
  </Teleport>
</template>
