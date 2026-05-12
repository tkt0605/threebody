<script setup lang="ts">
import { ref } from 'vue'
import AppAside from '../components/AppAside.vue'
import AppHeader from '../components/AppHeader.vue'

type SceneType = '情景' | '心情' | '対話'

type Scene = {
  id:      number
  text:    string
  type:    SceneType
  summary: string
}

const url      = ref('')
const title    = ref('')
const author   = ref('')
const rawText  = ref('')
const scenes   = ref<Scene[]>([])
const loading  = ref<'idle' | 'fetching' | 'splitting'>('idle')
const error    = ref('')
const provider = ref<'openai' | 'anthropic' | 'deepseek' | 'ollama'>('openai')

const TYPE_COLOR: Record<SceneType, string> = {
  情景: '#60a5fa',  // blue-400
  心情: '#f472b6',  // pink-400
  対話: '#4ade80',  // green-400
}

async function fetchText() {
  if (!url.value.trim()) return
  error.value  = ''
  scenes.value = []
  rawText.value = ''
  loading.value = 'fetching'

  try {
    const res  = await fetch('http://localhost:3000/api/aozora/fetch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: url.value.trim() }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? '取得失敗')
    title.value   = data.title
    author.value  = data.author
    rawText.value = data.text
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = 'idle'
    return
  }

  await splitScenes()
}

async function splitScenes() {
  if (!rawText.value) return
  loading.value = 'splitting'
  scenes.value  = []
  error.value   = ''

  try {
    const res  = await fetch('http://localhost:3000/api/aozora/split', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: rawText.value, title: title.value, author: author.value, provider: provider.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'シーン分割失敗')
    scenes.value = data.scenes
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = 'idle'
  }
}
</script>

<template>
  <div class="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <AppAside />

    <div class="flex flex-col flex-1 min-w-0">
      <AppHeader />

      <main class="flex-1 overflow-y-auto px-8 py-6">
        <!-- ヘッダー -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white/90 tracking-tight">
            小説作品 → シーン分割
          </h1>
          <p class="text-sm text-gray-500 dark:text-white/40 mt-0.5">Phase 1 — テキスト取得 &amp; シーン分析</p>
        </div>

        <!-- URL入力 -->
        <div class="flex gap-3 mb-3">
          <input
            v-model="url"
            type="url"
            placeholder="https://www.aozora.gr.jp/cards/.../files/....html"
            class="flex-1 px-4 py-2.5 text-sm rounded-xl border border-black/10 dark:border-white/10
                   bg-white dark:bg-white/5 text-gray-900 dark:text-white/90
                   placeholder-gray-400 dark:placeholder-white/25
                   focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            @keydown.enter="fetchText"
          />
          <button
            class="px-5 py-2.5 text-sm font-medium rounded-xl transition-all cursor-pointer
                   bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="loading !== 'idle' || !url.trim()"
            @click="fetchText"
          >
            <span v-if="loading === 'fetching'">取得中...</span>
            <span v-else-if="loading === 'splitting'">分割中...</span>
            <span v-else>実行</span>
          </button>
        </div>

        <!-- LLM プロバイダー選択 -->
        <div class="flex items-center gap-2 mb-6">
          <span class="text-xs text-gray-400 dark:text-white/30">LLM:</span>
          <button
            v-for="p in ['openai', 'anthropic', 'deepseek', 'ollama']"
            :key="p"
            class="px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer"
            :class="provider === p
              ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
              : 'border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 hover:border-black/20 dark:hover:border-white/20'"
            @click="provider = p as typeof provider"
          >{{ p }}</button>
        </div>

        
        <div
          v-if="error"
          class="mb-5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 text-sm"
        >
          {{ error }}
        </div>

        <!-- ローディング -->
        <div v-if="loading !== 'idle'" class="flex items-center gap-3 mb-5 text-sm text-gray-500 dark:text-white/40">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
          </svg>
          {{ loading === 'fetching' ? 'テキストを取得しています...' : 'LLMがシーンを分析しています...' }}
        </div>

        <!-- 作品情報 -->
        <div v-if="title" class="mb-5 px-4 py-3 rounded-xl bg-white dark:bg-white/4 border border-black/8 dark:border-white/8">
          <div class="text-base font-semibold text-gray-900 dark:text-white/90">{{ title }}</div>
          <div class="text-sm text-gray-500 dark:text-white/45 mt-0.5">{{ author }}</div>
          <div class="text-xs text-gray-400 dark:text-white/25 mt-1">{{ rawText.length.toLocaleString() }}文字取得</div>
        </div>

        <!-- シーン一覧 -->
        <div v-if="scenes.length" class="space-y-3">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-medium text-gray-700 dark:text-white/70">{{ scenes.length }} シーン</span>
            <div class="flex gap-3 ml-2">
              <span v-for="type in (['情景','心情','対話'] as SceneType[])" :key="type"
                class="flex items-center gap-1 text-xs text-gray-500 dark:text-white/40">
                <span class="w-2 h-2 rounded-full" :style="{ background: TYPE_COLOR[type] }" />
                {{ type }} {{ scenes.filter(s => s.type === type).length }}
              </span>
            </div>
          </div>

          <div
            v-for="scene in scenes"
            :key="scene.id"
            class="rounded-xl border border-black/8 dark:border-white/8 bg-white dark:bg-white/4 p-4
                   hover:border-black/15 dark:hover:border-white/15 transition-colors"
          >
            <div class="flex items-start gap-3">
              <!-- シーン番号 -->
              <span class="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-semibold
                           bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-white/45 mt-0.5">
                {{ scene.id }}
              </span>

              <div class="flex-1 min-w-0">
                <!-- タイプバッジ + サマリー -->
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                    :style="{ background: TYPE_COLOR[scene.type] + '22', color: TYPE_COLOR[scene.type] }"
                  >
                    {{ scene.type }}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-white/40 truncate">{{ scene.summary }}</span>
                </div>

                <!-- テキスト -->
                <p class="text-sm text-gray-800 dark:text-white/80 leading-relaxed whitespace-pre-wrap">
                  {{ scene.text }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状態 -->
        <div v-else-if="loading === 'idle' && !error" class="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-white/20">
          <svg class="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p class="text-sm">青空文庫のURLを入力して実行してください</p>
          <p class="text-xs mt-1 opacity-60">例: 芥川龍之介「羅生門」「藪の中」など</p>
        </div>
      </main>
    </div>
  </div>
</template>
