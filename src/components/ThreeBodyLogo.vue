<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const S = 32
const C = S / 2
const PHASE2 = (Math.PI * 2) / 3
const PHASE3 = (Math.PI * 4) / 3

interface Point { x: number; y: number }

const b1 = ref<Point>({ x: C, y: C })
const b2 = ref<Point>({ x: C, y: C })
const b3 = ref<Point>({ x: C, y: C })

let raf: number
let t = 0

function tick() {
  t += 0.012
  b1.value = { x: C + 9   * Math.cos(t),              y: C + 9   * Math.sin(t)              * 0.6 }
  b2.value = { x: C + 8   * Math.cos(t * 0.83 + PHASE2), y: C + 8   * Math.sin(t * 0.83 + PHASE2) * 0.6 }
  b3.value = { x: C + 7.5 * Math.cos(t * 1.17 + PHASE3), y: C + 7.5 * Math.sin(t * 1.17 + PHASE3) * 0.6 }
  raf = requestAnimationFrame(tick)
}

onMounted(() => { raf = requestAnimationFrame(tick) })
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <svg :viewBox="`0 0 ${S} ${S}`" class="w-10 h-10 shrink-0" fill="none">
    <!-- Lines between bodies -->
    <line :x1="b1.x" :y1="b1.y" :x2="b2.x" :y2="b2.y" stroke="white" stroke-width="0.7" opacity="0.55"/>
    <line :x1="b2.x" :y1="b2.y" :x2="b3.x" :y2="b3.y" stroke="white" stroke-width="0.7" opacity="0.55"/>
    <line :x1="b3.x" :y1="b3.y" :x2="b1.x" :y2="b1.y" stroke="white" stroke-width="0.7" opacity="0.55"/>

    <!-- Lines to center of mass -->
    <line :x1="b1.x" :y1="b1.y" :x2="C" :y2="C" stroke="white" stroke-width="0.4" opacity="0.22"/>
    <line :x1="b2.x" :y1="b2.y" :x2="C" :y2="C" stroke="white" stroke-width="0.4" opacity="0.22"/>
    <line :x1="b3.x" :y1="b3.y" :x2="C" :y2="C" stroke="white" stroke-width="0.4" opacity="0.22"/>

    <!-- Center of mass -->
    <circle :cx="C" :cy="C" r="0.9" fill="white" opacity="0.35"/>

    <!-- Bodies -->
    <circle :cx="b1.x" :cy="b1.y" r="1.8" fill="#818cf8"/>
    <circle :cx="b2.x" :cy="b2.y" r="1.5" fill="#a78bfa"/>
    <circle :cx="b3.x" :cy="b3.y" r="1.6" fill="#38bdf8"/>
  </svg>
</template>
