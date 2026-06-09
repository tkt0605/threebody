<script setup lang="ts">
import { marked } from 'marked'
import type { Message } from '../types/message'
import DOMPurify from 'dompurify'
defineProps<{ message: Message }>()

marked.setOptions({ breaks: true })

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const language = (lang ?? '').trim().split(/\s+/)[0] ?? ''
  const code = escapeHtml(text.replace(/\n$/, ''))
  return `<div class="code-block">
<div class="code-block-header">
<span class="code-block-lang">${escapeHtml(language)}</span>
<button type="button" class="copy-btn">
<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
  <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>
</svg>
<svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
  <path d="M13.485 1.929a.75.75 0 0 1 .07 1.058l-7.25 8.25a.75.75 0 0 1-1.114.045l-3.25-3.5a.75.75 0 1 1 1.098-1.022l2.668 2.872 6.722-7.65a.75.75 0 0 1 1.058-.07z"/>
</svg>
</button>
</div>
<pre><code class="language-${escapeHtml(language)}">${code}\n</code></pre>
</div>`
}
marked.use({ renderer })

function renderMarkdown(content: string): string {
  return String(marked.parse(content))
}

function handleCopyClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('.copy-btn')
  if (!button) return

  const code = button.closest('.code-block')?.querySelector('code')
  if (!code) return

  navigator.clipboard.writeText(code.textContent ?? '').then(() => {
    button.classList.add('copied')
    button.disabled = true
    setTimeout(() => {
      button.classList.remove('copied')
      button.disabled = false
    }, 1500)
  }).catch(() => {
    // クリップボードAPIが使えない環境では何もしない
  })
}
</script>

<template>
  <div class="flex flex-col w-full">
    <span
      class="px-4 pt-3 pb-0.5 text-xs font-medium tracking-wide"
      :class="message.role === 'user'
        ? 'text-gray-400 dark:text-gray-500'
        : 'text-indigo-400'"
    >
      {{ message.role === 'user' ? 'あなた' : 'I.R.I.S' }}
    </span>
    <div
      class="max-w-[100%] px-6 py-4 text-sm leading-relaxed"
      :class="
        message.role === 'user'
          ? 'w-full border-b border-gray-600 dark:text-white text-gray-900'
          : 'backdrop-blur-sm dark:text-gray-300 text-gray-800'
      "
    >
      <template v-for="(block, i) in message.blocks" :key="i">
        <span class="block" v-if="block.type === 'text' && (block.content || message.streaming) && message.role === 'user'">
          ❯ {{ block.content }}<span v-if="message.streaming" class="animate-pulse">▍</span>
        </span>
        <div
          v-else-if="block.type === 'text' && (block.content || message.streaming) && message.role === 'assistant'"
          class="prose-content"
          v-html="DOMPurify.sanitize(renderMarkdown(block.content)) + (message.streaming ? '<span class=\'animate-pulse\'>▍</span>' : '')"
          @click="handleCopyClick"
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
.prose-content :deep(.code-block) {
  margin-bottom: 0.5em;
  border-radius: 0.5em;
  overflow: hidden;
  background: #262a33;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e2e4e9;
}
.prose-content :deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25em 0.75em;
  font-size: 0.75em;
  background: #2f3440;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
}
.prose-content :deep(.code-block-lang) {
  font-family: ui-monospace, monospace;
  opacity: 0.6;
  text-transform: lowercase;
}
.prose-content :deep(.copy-btn) {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  font-size: 0.75em;
  padding: 0.15em 0.6em;
  border-radius: 0.35em;
  border: 1px solid rgba(128, 128, 128, 0.3);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.prose-content :deep(.copy-btn:hover) {
  background: rgba(128, 128, 128, 0.15);
}
.prose-content :deep(.copy-btn:disabled) {
  opacity: 0.6;
  cursor: default;
}
.prose-content :deep(.check-icon) {
  display: none;
  color: #4ade80;
}
.prose-content :deep(.copy-btn.copied) {
  border-color: rgba(74, 222, 128, 0.4);
}
.prose-content :deep(.copy-btn.copied .copy-icon) {
  display: none;
}
.prose-content :deep(.copy-btn.copied .check-icon) {
  display: inline;
}
.prose-content :deep(.code-block pre) {
  margin-bottom: 0;
  border-radius: 0;
  background: none;
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
