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

// 答えの付いていないユーザー発言に、何が起きたのかを添える。
//
//   'stopped' … ユーザーが自分で止めた（停止ボタン・バージイン）
//   'lost'    … 応答が届かなかった（エラー、保存前の離脱）
//   null      … 孤立していない
//
// 判定に visibleMessages を使ってはいけない。一文字も出ないうちに終わった応答は
// 0ブロックなのでそこから除外されており、その行こそが signals.interrupted という
// 理由を持っているため。除外前の props.messages を見る必要がある
// 共有するターンに添える「問い」。直前のユーザー発言を指す。
// 判定に visibleMessages を使わないのは orphanReason と同じ理由で、
// 0ブロックの行も並びの一部だから
function questionMessageId(msg: Message): string | null {
  if (msg.role !== 'assistant') return null
  const all  = props.messages
  const prev = all[all.indexOf(msg) - 1]
  return prev?.role === 'user' ? prev.id : null
}

type OrphanReason = 'stopped' | 'lost' | null

function orphanReason(msg: Message): OrphanReason {
  if (msg.role !== 'user') return null

  const all  = props.messages
  const next = all[all.indexOf(msg) + 1]

  // 中身のある応答が続いていれば孤立ではない
  if (next?.role === 'assistant' && next.blocks.length > 0) return null

  // 応答の器すら無い＝保存される前に失われた
  if (!next || next.role !== 'assistant') return 'lost'

  // 器はあるが中身が無い。止めたのなら interrupted が立っている（useChat.cancelGeneration）
  return next.signals?.interrupted ? 'stopped' : 'lost'
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
        :orphan-reason="orphanReason(msg)"
        :question-message-id="questionMessageId(msg)"
      />
      <MessageBubble v-if="draftMessage" :message="draftMessage" />
    </div>
  </div>
</template>
