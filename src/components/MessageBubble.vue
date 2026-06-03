<script setup lang="ts">
import { marked } from 'marked'
import type { Message } from '../types/message'

defineProps<{ message: Message }>()

marked.setOptions({ breaks: true })

function renderMarkdown(content: string): string {
  return String(marked.parse(content))
}
</script>

<template>
  <div
    class="flex w-full"
  >
    <div
      class="max-w-[100%] px-4 py-3 text-sm leading-relaxed"
      :class="
        message.role === 'user'
          ? 'w-full border-t border-b border-gray-600 dark:text-white text-gray-900'
          : 'backdrop-blur-sm  dark:text-gray-300 text-gray-800 '
      "
    >
      <template v-for="(block, i) in message.blocks" :key="i">
        <span v-if="block.type === 'text' && (block.content || message.streaming) && message.role === 'user'">
          ❯ {{ block.content }}<span v-if="message.streaming" class="animate-pulse">▍</span>
        </span>
        <div
          v-else-if="block.type === 'text' && (block.content || message.streaming) && message.role === 'assistant'"
          class="prose-content"
          v-html="renderMarkdown(block.content) + (message.streaming ? '<span class=\'animate-pulse\'>▍</span>' : '')"
        />
        <div
          v-else-if="block.type === 'error'"
          class="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs bg-red-500/10 border border-red-500/30 text-red-300 mt-1"
        >
          <svg class="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ block.message }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.prose-content :deep(p) {
  margin-bottom: 0.5em;
}
.prose-content :deep(p:last-child) {
  margin-bottom: 0;
}
.prose-content :deep(h1),
.prose-content :deep(h2),
.prose-content :deep(h3),
.prose-content :deep(h4) {
  font-weight: 600;
  margin-top: 0.75em;
  margin-bottom: 0.25em;
}
.prose-content :deep(h1) { font-size: 1.2em; }
.prose-content :deep(h2) { font-size: 1.1em; }
.prose-content :deep(h3) { font-size: 1em; }
.prose-content :deep(ul),
.prose-content :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: 0.5em;
}
.prose-content :deep(li) {
  margin-bottom: 0.15em;
}
.prose-content :deep(code) {
  font-family: ui-monospace, monospace;
  background: rgba(128, 128, 128, 0.15);
  padding: 0.1em 0.3em;
  border-radius: 0.25em;
  font-size: 0.85em;
}
.prose-content :deep(pre) {
  background: rgba(0, 0, 0, 0.25);
  padding: 0.75em 1em;
  border-radius: 0.5em;
  overflow-x: auto;
  margin-bottom: 0.5em;
}
.prose-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.9em;
}
.prose-content :deep(strong) {
  font-weight: 600;
}
.prose-content :deep(em) {
  font-style: italic;
}
.prose-content :deep(blockquote) {
  border-left: 2px solid rgba(128, 128, 128, 0.35);
  padding-left: 0.75em;
  opacity: 0.75;
  margin-bottom: 0.5em;
}
.prose-content :deep(a) {
  text-decoration: underline;
  opacity: 0.8;
}
.prose-content :deep(hr) {
  border: none;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  margin: 0.75em 0;
}
</style>
