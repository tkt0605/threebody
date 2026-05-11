<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useSettings, type Language, type ThinkingLevel, type Provider, type Sex } from '../composables/useSettings'
import { useTheme } from '../composables/useTheme'

const { settings } = useSettings()
const { isDark } = useTheme()

const inactiveBtnStyle = computed(() => ({
  background: 'transparent',
  borderColor: isDark.value ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)',
  color: isDark.value ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
}))

const dialogRef = ref<HTMLDialogElement | null>(null)

const SEX_OPTIONS: {value: Sex; label: string}[]=[
  { value: "man", label: "男性"},
  { value: "woman", label: "女性"}
]

const PROVIDERS: { value: Provider; label: string; desc: string }[] = [
  { value: 'ollama',    label: 'Ollama',    desc: 'ローカル（無料）' },
  { value: 'anthropic', label: 'Claude',    desc: 'Anthropic API' },
  { value: 'openai',    label: 'GPT',       desc: 'OpenAI API' },
  { value: 'deepseek',  label: 'DeepSeek',  desc: 'DeepSeek API' },
]

const THINKING_LEVELS: { value: ThinkingLevel; label: string; desc: string; color: string }[] = [
  { value: 1, label: '速答', desc: '考えずに即答',     color: '#64748b' },
  { value: 2, label: '概略', desc: '軽く推論',         color: '#0ea5e9' },
  { value: 3, label: '標準', desc: 'バランス思考',     color: '#6366f1' },
  { value: 4, label: '深考', desc: '複雑な問題向け',   color: '#8b5cf6' },
  { value: 5, label: '限界', desc: '最大思考リソース', color: '#f43f5e' },
]

const draft = reactive({
  language: settings.language,
  sex: settings.sex,
  thinkingLevel: settings.thinkingLevel,
  systemPrompt: settings.systemPrompt,
  provider: settings.provider,
  mcpServers: settings.mcpServers.map(s => ({ ...s })),
})

function open() {
  draft.language = settings.language
  draft.sex = settings.sex
  draft.thinkingLevel = settings.thinkingLevel
  draft.systemPrompt = settings.systemPrompt
  draft.provider = settings.provider
  draft.mcpServers = settings.mcpServers.map(s => ({ ...s }))
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
}

function save() {
  settings.language = draft.language
  settings.sex = draft.sex
  settings.thinkingLevel = draft.thinkingLevel
  settings.systemPrompt = draft.systemPrompt
  settings.provider = draft.provider
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
      class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[480px] rounded-2xl p-0 shadow-2xl
             bg-white text-gray-900 border border-black/10
             dark:bg-gray-900 dark:text-white dark:border-white/10
             backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      @click.self="close"
    >
      <div class="flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-black/8 dark:border-white/8">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white/90">設定</h2>
          <button
            class="transition-colors cursor-pointer text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/80"
            @click="close"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="px-6 py-5 space-y-6">

          <!-- プロバイダー -->
          <div class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">プロバイダー</label>
            <div class="grid grid-cols-2 gap-1.5">
              <button
                v-for="opt in PROVIDERS"
                :key="opt.value"
                class="flex flex-col items-start px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer border"
                :class="draft.provider === opt.value
                  ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-600 dark:text-indigo-300'
                  : 'border-black/8 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:bg-white/4 dark:border-white/7 dark:text-white/45 dark:hover:text-white/70 dark:hover:bg-white/8'"
                @click="draft.provider = opt.value"
              >
                <span class="font-semibold">{{ opt.label }}</span>
                <span class="mt-0.5 text-gray-400 dark:text-white/35">{{ opt.desc }}</span>
              </button>
            </div>
          </div>

          <!-- 言語 -->
          <div class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">言語</label>
            <div class="flex gap-2">
              <button
                v-for="opt in ([{ value: 'ja', label: '日本語' }, { value: 'en', label: 'English' }] as { value: Language; label: string }[])"
                :key="opt.value"
                class="px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer"
                :class="draft.language === opt.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:bg-white/6 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10'"
                @click="draft.language = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <!-- 性別 -->
          <div class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">性別</label>
            <div class="flex gap-2">
              <button
                v-for="opt in ([{ value: 'man', label: '男性' }, { value: 'woman', label: '女性' }] as { value: Sex; label: string }[])"
                :key="opt.value"
                class="px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer"
                :class="draft.sex === opt.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:bg-white/6 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10'"
                @click="draft.sex = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <!-- 思考レベル -->
          <div class="space-y-3">
            <div class="flex items-baseline justify-between">
              <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">思考レベル</label>
              <span class="text-xs" :style="{ color: THINKING_LEVELS[draft.thinkingLevel - 1]!.color }">
                Lv.{{ draft.thinkingLevel }} — {{ THINKING_LEVELS[draft.thinkingLevel - 1]!.desc }}
              </span>
            </div>
            <div class="flex gap-1.5">
              <button
                v-for="lvl in THINKING_LEVELS"
                :key="lvl.value"
                class="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs transition-all cursor-pointer border"
                :style="draft.thinkingLevel === lvl.value
                  ? { background: lvl.color + '22', borderColor: lvl.color + '99', color: lvl.color }
                  : inactiveBtnStyle"
                @click="draft.thinkingLevel = lvl.value"
              >
                <span class="font-bold text-sm">{{ lvl.value }}</span>
                <span class="tracking-wide">{{ lvl.label }}</span>
              </button>
            </div>
          </div>

          <!-- システムプロンプト -->
          <div class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">システムプロンプト</label>
            <textarea
              v-model="draft.systemPrompt"
              rows="5"
              placeholder="AIの根本的な振る舞いを定義してください..."
              class="w-full rounded-xl text-sm px-4 py-3 outline-none resize-none leading-relaxed transition-colors
                     bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-black/20
                     dark:bg-white/5 dark:border-white/8 dark:text-white/90 dark:placeholder-white/20 dark:focus:border-white/20"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-black/8 dark:border-white/8">
          <button
            class="px-4 py-2 rounded-xl text-sm transition-colors cursor-pointer
                   text-gray-500 hover:text-gray-800 hover:bg-gray-100
                   dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/6"
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
