<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { Message } from '../types/message'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ messages: Message[]; draftMessage?: Message | null }>()

const container = ref<HTMLElement | null>(null)

// 応答がまだ書き換わっている間は aria-busy を立て、スクリーンリーダーに
// 「読むのは完成してから」を伝える。完成後の読み上げは ChatLiveRegion が担当する
const streaming = computed(() => props.messages.at(-1)?.streaming === true)

function scrollToBottom() {
  void nextTick(() => {
    if (container.value) {
      container.value.scrollTop = container.value.scrollHeight
    }
  })
}

watch(() => props.messages, scrollToBottom, { deep: true })
watch(() => props.draftMessage, scrollToBottom, { deep: true })

// 描画するメッセージ。ブロックが1つも無いものは画面に出さない。
//
// 一文字も書かれないうちに停止された応答は、本文を持たないまま signals（interrupted）
// だけを載せてDBに残る（useChat.persistMessage）。そのまま描くと MessageBubble の
// 話者ラベルは blocks ループの外にあるため、「I.R.I.S」だけの空バブルになる。
// ここで落とすことで、記録は残しつつ画面には出さない。
const visibleMessages = computed(() => props.messages.filter(m => m.blocks.length > 0))

// リロード等でAIの返答が保存される前に途切れ、応答が欠けたまま宙ぶらりんになったユーザー発言かどうか。
// 空の応答を除外した後の並びで見るため、0文字で停止された質問は「送り直せる」状態に戻る
function isOrphaned(msg: Message, index: number): boolean {
  if (msg.role !== 'user') return false
  const next = visibleMessages.value[index + 1]
  return !next || next.role !== 'assistant'
}
</script>

<template>
  <!-- role="log" は既定で aria-live="polite" 相当になるが、ここでは明示的に off にする。
       ストリーミング中は本文が1トークンごとに書き換わり、そのたびに読み直されて
       かえって聞き取れなくなるため。読み上げは ChatLiveRegion に一本化している -->
  <div
    ref="container"
    role="log"
    aria-label="会話ログ"
    aria-live="off"
    :aria-busy="streaming"
    class="flex-1 overflow-y-auto scroll-smooth [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full"
  >
      <div v-if="visibleMessages.length === 0 && !draftMessage" class="flex h-full items-center justify-center">
        <div class="text-black/20 dark:text-white/40 text-sm select-none">
          最初の会話を始めましょう。
        </div>
      </div>
    <div class="max-w-3xl mx-auto px-4 space-y-3">
      <MessageBubble
        v-for="(msg, idx) in visibleMessages"
        :key="msg.id"
        :message="msg"
        :orphaned="isOrphaned(msg, idx)"
      />
      <MessageBubble v-if="draftMessage" :message="draftMessage" />
    </div>
  </div>
</template>
