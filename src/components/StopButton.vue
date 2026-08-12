<script setup lang="ts">
// 生成中に押せる唯一の「止める」入口。
// 中央の球体・会話ログ下部・音声ダイアログの3箇所から同じ見た目・同じ意味で使う
withDefaults(defineProps<{ label?: string }>(), { label: '停止' })

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors
           border border-black/10 bg-white/70 text-gray-600 hover:bg-gray-200/70
           dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
    aria-label="生成を停止する"
    @click="emit('click')"
  >
    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
    {{ label }}
  </button>
</template>
