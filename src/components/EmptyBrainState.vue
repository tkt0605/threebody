<script setup lang="ts">
import { computed } from 'vue'
import { FALLBACK_DAILY_LIMIT, type SharedKeyCapability } from '../composables/useCapabilities'

const props = defineProps<{ sharedKey?: SharedKeyCapability | undefined }>()
const emit = defineEmits<{ 'open-settings': [] }>()

// 表示メッセージは共有キーの状態で出し分ける。「APIキーを入れて」だけだと、
// 本当は無料枠が残っている（未ログイン）/ 今日はもう使い切っただけ、のケースまで
// 一律「未設定」に見せてしまい、共有キーの存在に気づけない
const heading = computed(() => {
  switch (props.sharedKey?.reason) {
    case 'not_signed_in':        return 'ログインすると無料でお試しできるよ'
    case 'limit_reached':        return '今日の無料分を使い切ったよ'
    // 「あなたが使い切った」ではないので文言を分ける。全体枠で止まったユーザーは
    // 今日まだ1回も使っていないことがある
    case 'global_limit_reached': return '今日はみんなの無料枠がいっぱいだよ'
    default:                     return '脳みそがまだないよ、、、'
  }
})

const subtext = computed(() => {
  switch (props.sharedKey?.reason) {
    case 'not_signed_in':
      return `ログインすれば1日${props.sharedKey?.dailyLimit ?? FALLBACK_DAILY_LIMIT}回まで、キー無しで試せます。`
    case 'limit_reached':
      return '明日また無料枠が使えます。続けて使うなら設定から自分のAPIキーを登録してね。'
    case 'global_limit_reached':
      return '本日ぶんのお試し枠が終了しました。明日また使えます。今すぐ使うなら設定から自分のAPIキーを登録してね。'
    default:
      return 'APIキーとモデルを入れてね。（例：Anthropic, OpenAI等々）'
  }
})
</script>

<template>
  <div class="flex flex-col items-center gap-4 px-6 text-center select-none">
    <!-- 泣き顔 -->
     <svg width="132" height="114" viewBox="0 0 120 104" fill="none" stroke="currentColor" aria-hidden="true">
      <g opacity="0.3" stroke-width="1.5" stroke-linecap="round">
        <line x1="53.2" y1="24.1" x2="24.8" y2="69.9" />
        <line x1="66.8" y1="24.1" x2="95.2" y2="69.9" />
        <line x1="31" y1="81" x2="89" y2="81" />
      </g>
      <g opacity="0.5" stroke-width="1.75" stroke-dasharray="3 5" stroke-linecap="round">
        <circle cx="60" cy="13" r="13" />
        <circle cx="18" cy="81" r="13" />
        <circle cx="102" cy="81" r="13" />
      </g>
      <circle cx="60" cy="58" r="4.5" fill="currentColor" stroke="none" opacity="0.22" />
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
