<script setup lang="ts">
import { computed } from 'vue'
import type { SharedKeyCapability } from '../composables/useCapabilities'

const props = defineProps<{ sharedKey?: SharedKeyCapability | undefined }>()
const emit = defineEmits<{ 'open-settings': [] }>()

// 表示メッセージは共有キーの状態で出し分ける。「APIキーを入れて」だけだと、
// 本当は無料枠が残っている（未ログイン）/ 今日はもう使い切っただけ、のケースまで
// 一律「未設定」に見せてしまい、共有キーの存在に気づけない
const heading = computed(() => {
  switch (props.sharedKey?.reason) {
    case 'not_signed_in':  return 'ログインすると無料でお試しできるよ'
    case 'limit_reached':  return '今日の無料分を使い切ったよ'
    default:                return '脳みそがまだないよ、、、'
  }
})

const subtext = computed(() => {
  switch (props.sharedKey?.reason) {
    case 'not_signed_in':
      return `ログインすれば1日${props.sharedKey?.dailyLimit ?? 5}回まで、キー無しで試せます。`
    case 'limit_reached':
      return '明日また無料枠が使えます。続けて使うなら設定から自分のAPIキーを登録してね。'
    default:
      return 'APIキーとモデルを入れてね。（例：Anthropic, OpenAI等々）'
  }
})
</script>

<template>
  <div class="flex flex-col items-center gap-4 px-6 text-center select-none">
    <!-- 泣き顔 -->
    <svg class="w-20 h-20 text-gray-300 dark:text-white/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="9.5"/>
      <path d="M8.5 10.2h.01M15.5 10.2h.01" stroke-linecap="round" stroke-width="2.2"/>
      <path d="M8.3 16.2c1-1.2 2.3-1.8 3.7-1.8s2.7.6 3.7 1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9 11.5c-.3 1-.9 1.7-.9 2.6a1 1 0 001 1" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
    </svg>

    <div class="space-y-1.5">
      <p class="text-gray-500 dark:text-white/50 text-sm font-medium">{{ heading }}</p>
      <p class="text-gray-400 dark:text-white/35 text-xs">{{ subtext }}</p>
    </div>

    <button
      class="mt-1 px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer
             bg-indigo-600/12 text-indigo-600 hover:bg-indigo-600/20
             dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
      @click="emit('open-settings')"
    >
      設定を開く
    </button>
  </div>
</template>
