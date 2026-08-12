<script setup lang="ts">
import { useChatAnnouncer } from '../composables/useChatAnnouncer'

// 目には見えず、スクリーンリーダーにだけ届く1行。
// 中身の組み立ては useChatAnnouncer 側にあり、ここは出力先を用意するだけ
const { announcement } = useChatAnnouncer()
</script>

<template>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</div>
</template>
