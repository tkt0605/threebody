<script setup lang="ts">
// SpeechRecognition のイベント発火を実機の画面に出すだけの一時的な表示。
// ?srdebug=1 が付いていなければ何も描かない。詳しい経緯は lib/srDebug.ts
import { SR_DEBUG, srLog } from '../lib/srDebug'
</script>

<template>
  <!-- 操作を邪魔しないよう pointer-events は殺す。読むだけの層 -->
  <div
    v-if="SR_DEBUG"
    class="fixed left-1 bottom-1 z-50 pointer-events-none max-w-[70vw]
           rounded bg-black/75 px-2 py-1 font-mono text-[10px] leading-tight text-lime-300"
  >
    <div v-if="!srLog.length">srdebug: waiting…</div>
    <div v-for="(line, i) in srLog" :key="i" class="whitespace-pre">{{ line }}</div>
  </div>
</template>
