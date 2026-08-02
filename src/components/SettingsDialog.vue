<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import {  useSettings,  isBodyUsable,  type Language, type ThinkingLevel, type Provider, type VoiceStyle, type Preset, type BodyProvider, type BodyConfig } from '../composables/useSettings'
import { 
  VOICE_STYLE_OPTIONS,
  PRESET_OPTIONS
} from '../composables/useSettingsOptions'
import { useTheme } from '../composables/useTheme'
import { BODY_PROVIDER_COLORS } from '../constants/bodyProviders'

const { settings } = useSettings()
const { isDark } = useTheme()

const inactiveBtnStyle = computed(() => ({
  background: 'transparent',
  borderColor: isDark.value ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)',
  color: isDark.value ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
}))

const dialogRef = ref<HTMLDialogElement | null>(null)

const BODY_PROVIDERS: { value: BodyProvider; label: string; color: string }[] = [
  { value: 'ollama',    label: 'Ollama',    color: BODY_PROVIDER_COLORS.ollama },
  { value: 'openai',    label: 'GPT',       color: BODY_PROVIDER_COLORS.openai },
  { value: 'anthropic', label: 'Claude',    color: BODY_PROVIDER_COLORS.anthropic },
  { value: 'deepseek',  label: 'DeepSeek',  color: BODY_PROVIDER_COLORS.deepseek },
]

const MODEL_PLACEHOLDERS: Record<BodyProvider, string> = {
  ollama:    '空欄で既定モデル（例: qwen2.5:7b）',
  openai:    'モデル名（例: gpt-4o）',
  anthropic: 'モデル名（例: claude-sonnet-4-6）',
  deepseek:  'モデル名（例: deepseek-chat）',
}

const BODY_NAMES = ['一体', '二体', '三体'] as const

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
]

// 思考レベルは1〜5の5段階。バックエンドの LEVEL_CONFIG がモデル階層・maxTokens・
// thinking パラメータをこの値から決めるため、UIの選択肢と値は1対1で対応させる
const THINKING_LEVELS: { value: ThinkingLevel; label: string; desc: string; color: string }[] = [
  { value: 1, label: '速答', desc: '考えずに即答',     color: '#64748b' },
  { value: 2, label: '概略', desc: '軽く推論',         color: '#0ea5e9' },
  { value: 3, label: '標準', desc: 'バランス思考',     color: '#6366f1' },
  { value: 4, label: '深考', desc: '複雑な問題向け',   color: '#8b5cf6' },
  { value: 5, label: '限界', desc: '最大思考リソース', color: '#f43f5e' },
]

const showAdvanced = ref(false)

function cloneBody(b: BodyConfig): BodyConfig {
  return { role: b.role, provider: b.provider, apiKey: b.apiKey, model: b.model }
}

const isBodyActive = isBodyUsable


const draft = reactive({
  language:      settings.language,
  voiceStyle:    settings.voiceStyle,
  preset:        settings.preset,
  thinkingLevel: settings.thinkingLevel,
  systemPrompt:  settings.systemPrompt,
  provider:      settings.provider as Provider,
  bodies:        settings.bodies.map(cloneBody) as [BodyConfig, BodyConfig, BodyConfig],
})

function open() {
  draft.language      = settings.language
  draft.voiceStyle    = settings.voiceStyle
  draft.preset        = settings.preset
  draft.thinkingLevel = settings.thinkingLevel
  draft.systemPrompt  = settings.systemPrompt
  draft.provider      = settings.provider
  draft.bodies        = settings.bodies.map(cloneBody) as [BodyConfig, BodyConfig, BodyConfig]
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
}

function save() {
  settings.language      = draft.language
  settings.voiceStyle    = draft.voiceStyle as VoiceStyle
  settings.preset        = draft.preset as Preset
  settings.thinkingLevel = draft.thinkingLevel
  settings.systemPrompt  = draft.systemPrompt
  draft.bodies.forEach((b, i) => {
    settings.bodies[i]!.provider = b.provider
    settings.bodies[i]!.apiKey   = b.apiKey
    settings.bodies[i]!.model    = b.model
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
      <div class="flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-black/8 dark:border-white/8 shrink-0">
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
        <div class="px-6 py-5 space-y-6 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full">

          <!-- 言語 -->
          <div class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">言語</label>
            <div class="relative">
              <select
                v-model="draft.language"
                class="w-full appearance-none rounded-xl text-sm px-4 py-2 pr-9 outline-none cursor-pointer transition-colors
                       bg-gray-50 border border-black/8 text-gray-900 focus:border-black/20
                       dark:bg-white/5 dark:border-white/8 dark:text-white/90 dark:focus:border-white/20"
              >
                <option
                  v-for="opt in LANGUAGES"
                  :key="opt.value"
                  :value="opt.value"
                  class="bg-white text-gray-900 dark:bg-gray-800 dark:text-white"
                >
                  {{ opt.label }}
                </option>
              </select>
              <div class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/30">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </div>
          </div>

          <!-- 話し方 -->
          <div class="space-y-3">
            <div class="flex items-baseline justify-between">
              <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">話し方</label>
              <span class="text-xs text-gray-400 dark:text-white/30">
                {{ VOICE_STYLE_OPTIONS.find(o => o.value === draft.voiceStyle)?.desc ?? '' }}
              </span>
            </div>
            <div class="flex gap-1.5">
              <button
                v-for="opt in VOICE_STYLE_OPTIONS"
                :key="opt.value"
                class="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs transition-all cursor-pointer border"
                :class="draft.voiceStyle === opt.value
                  ? 'bg-indigo-500/10 border-indigo-500/60 text-indigo-500 dark:text-indigo-400'
                  : ''"
                :style="draft.voiceStyle !== opt.value ? inactiveBtnStyle : {}"
                @click="draft.voiceStyle = opt.value"
              >
                <span class="font-semibold">{{ opt.label }}</span>
              </button>
            </div>
          </div>
          <!-- プリセット -->
          <div class="space-y-3">
            <div class="flex items-baseline justify-between">
              <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">プリセット</label>
              <span class="text-xs text-gray-400 dark:text-white/30">
                {{ PRESET_OPTIONS.find(o => o.value === draft.preset)?.desc ?? '' }}
              </span>
            </div>
            <div class="flex gap-1.5">
              <button
                v-for="opt in PRESET_OPTIONS"
                :key="opt.value"
                class="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs transition-all cursor-pointer border"
                :class="draft.preset === opt.value
                  ? 'bg-indigo-500/10 border-indigo-500/60 text-indigo-500 dark:text-indigo-400'
                  : ''"
                :style="draft.preset !== opt.value ? inactiveBtnStyle : {}"
                @click="draft.preset = opt.value"
              >
                <span class="font-semibold">{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- 追加指示 -->
          <div class="space-y-2">
            <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">追加指示</label>
            <textarea
              v-model="draft.systemPrompt"
              rows="4"
              placeholder="ベース人格に上乗せする指示があれば..."
              class="w-full rounded-xl text-sm px-4 py-3 outline-none resize-none leading-relaxed transition-colors
                     bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-black/20
                     dark:bg-white/5 dark:border-white/8 dark:text-white/90 dark:placeholder-white/20 dark:focus:border-white/20"
            />
          </div>

          <!-- 詳細設定（プロバイダー/モデル/思考レベルの生の値） -->
          <div class="pt-1 border-t border-black/8 dark:border-white/8">
            <button
              class="w-full flex items-center justify-between py-3 text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50 cursor-pointer"
              @click="showAdvanced = !showAdvanced"
            >
              詳細設定
              <svg
                class="w-3.5 h-3.5 transition-transform"
                :class="showAdvanced ? 'rotate-180' : ''"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              >
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <div v-if="showAdvanced" class="space-y-6 pb-1">
              <!-- 三体接続 -->
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">三体接続</label>
                  <span class="text-xs text-gray-400 dark:text-white/30">有効な体を並列クエリし合成</span>
                </div>
                <div class="space-y-2">
                  <div
                    v-for="(body, idx) in draft.bodies"
                    :key="idx"
                    class="rounded-xl border p-3 transition-colors"
                    :class="isBodyActive(body)
                      ? 'border-indigo-500/40 bg-indigo-500/5 dark:bg-indigo-500/8'
                      : 'border-black/8 dark:border-white/8'"
                  >
                    <!-- Row header -->
                    <div class="flex items-center gap-2 mb-2">
                      <span
                        class="text-sm font-bold w-6 text-center"
                        :class="isBodyActive(body) ? 'text-indigo-500 dark:text-indigo-400' : 'text-gray-400 dark:text-white/25'"
                      >{{ BODY_NAMES[idx] }}</span>
                      <!-- Provider pills -->
                      <div class="flex gap-1 flex-1">
                        <button
                          v-for="p in BODY_PROVIDERS"
                          :key="p.value"
                          class="px-2 py-0.5 rounded-md text-xs transition-colors cursor-pointer border font-medium"
                          :style="body.provider === p.value
                            ? { background: p.color + '22', borderColor: p.color + '88', color: p.color }
                            : {}"
                          :class="body.provider !== p.value
                            ? 'border-black/8 text-gray-400 hover:text-gray-600 dark:border-white/8 dark:text-white/30 dark:hover:text-white/60'
                            : ''"
                          @click="body.provider = p.value"
                        >{{ p.label }}</button>
                      </div>
                      <!-- Active indicator -->
                      <span
                        class="text-xs px-1.5 py-0.5 rounded-md font-medium"
                        :class="isBodyActive(body)
                          ? 'bg-green-500/15 text-green-500 dark:text-green-400'
                          : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-white/25'"
                      >{{ isBodyActive(body) ? '有効' : '無効' }}</span>
                    </div>
                    <!-- Input field -->
                    <input
                      v-if="body.provider === 'ollama'"
                      v-model="body.model"
                      type="text"
                      :placeholder="MODEL_PLACEHOLDERS.ollama"
                      class="w-full rounded-lg text-xs px-3 py-1.5 outline-none transition-colors
                             bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-black/20
                             dark:bg-white/5 dark:border-white/8 dark:text-white/80 dark:placeholder-white/20 dark:focus:border-white/20"
                    />
                    <template v-else>
                      <input
                        v-model="body.apiKey"
                        type="password"
                        :placeholder="`${BODY_PROVIDERS.find(p => p.value === body.provider)?.label ?? ''} API キー`"
                        class="w-full rounded-lg text-xs px-3 py-1.5 outline-none transition-colors
                               bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-black/20
                               dark:bg-white/5 dark:border-white/8 dark:text-white/80 dark:placeholder-white/20 dark:focus:border-white/20"
                        autocomplete="off"
                      />
                      <input
                        v-model="body.model"
                        type="text"
                        :placeholder="MODEL_PLACEHOLDERS[body.provider]"
                        class="w-full rounded-lg text-xs px-3 py-1.5 outline-none transition-colors mt-1.5
                               bg-gray-50 border border-black/8 text-gray-900 placeholder-black/25 focus:border-black/20
                               dark:bg-white/5 dark:border-white/8 dark:text-white/80 dark:placeholder-white/20 dark:focus:border-white/20"
                      />
                    </template>
                  </div>
                </div>
              </div>

              <!-- 思考レベル（詳細: 1〜5） -->
              <!-- <div class="space-y-3">
                <div class="flex items-baseline justify-between">
                  <label class="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/50">思考レベル（詳細）</label>
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
              </div> -->
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