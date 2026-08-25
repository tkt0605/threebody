<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { Message } from '../types/message'
import { orphanReason } from '../lib/orphanReason'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ messages: Message[]; draftMessage?: Message | null }>()

// MessageBubble からの「編集して送る」「話し直す」をそのまま中継する。
// どのTextComposer/VoiceSphereDialogを操作するかを知っているのは ChatView だけなので、
// ここでは中身を判断せず素通しする
const emit = defineEmits<{
  'edit-request': [text: string]
  'redo-voice-request': []
}>()

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

// 共有するターンに添える「問い」。直前のユーザー発言を指す。
// 判定に visibleMessages を使わないのは orphanReason（lib/orphanReason.ts）と同じ理由で、
// 0ブロックの行も並びの一部だから
function questionMessageId(msg: Message): string | null {
  if (msg.role !== 'assistant') return null
  const all  = props.messages
  const prev = all[all.indexOf(msg) - 1]
  return prev?.role === 'user' ? prev.id : null
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
        v-for="msg in visibleMessages"
        :key="msg.id"
        :message="msg"
        :orphan-reason="orphanReason(msg, messages)"
        :question-message-id="questionMessageId(msg)"
        @edit-request="emit('edit-request', $event)"
        @redo-voice-request="emit('redo-voice-request')"
      />
      <MessageBubble v-if="draftMessage" :message="draftMessage" />
    </div>
  </div>
</template>
