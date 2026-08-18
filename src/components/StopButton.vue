<script setup lang="ts">
import { computed } from 'vue'

// 「止める」の入口。中央の球体・会話ログ下部・音声ダイアログの3箇所で同じ見た目を使う。
//
// 2つの意味を1つの部品で担う。読み上げは aiState が idle に戻った後もキューを
// 消化し続けるため、「生成を止める」と「声だけ黙らせる」は別々に要るタイミングがある。
//
//   generation … 答えごと要らない（生成を中断する。読み上げも巻き添えで止まる）
//   narration  … 答えは残したまま、声だけ黙らせる
//
// 文言まで分けるのは、読み上げ中に「停止」とだけ書いてあると、押した人が
// 答えごと消えると思って押せなくなるため
const props = withDefaults(defineProps<{ mode?: 'generation' | 'narration' }>(), { mode: 'generation' })

const emit = defineEmits<{ click: [] }>()

const isNarration = computed(() => props.mode === 'narration')
const label     = computed(() => isNarration.value ? '読み上げを止める' : '停止')
const ariaLabel = computed(() => isNarration.value ? '読み上げを停止する' : '生成を停止する')
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors
           border border-black/10 bg-white/70 text-gray-600 hover:bg-gray-200/70
           dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
    :aria-label="ariaLabel"
    @click="emit('click')"
  >
    <!-- 生成の停止＝四角、読み上げの停止＝消音。アイコンでも意味が違うことを示す -->
    <svg v-if="isNarration" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M23 9l-6 6M17 9l6 6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
    {{ label }}
  </button>
</template>
