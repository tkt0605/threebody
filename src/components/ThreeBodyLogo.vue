<!-- 三体（3つの黒点）が正三角形を作り、中心にシルバーの点が1つ静止する。
     以前は3点が軌道運動していたが、静止した三角形+中心点の意匠に変更。
     黒点はダーク画面（サイドバー・ログイン等）で背景に沈まないよう、
     ライト/ダークで色を反転させる（fill-gray-900 / dark:fill-gray-100）。
     中心のシルバーだけはテーマに関わらず固定色 -->
<template>
  <svg viewBox="0 0 32 32" class="w-10 h-10 shrink-0" fill="none">
    <!-- 三角形の辺 -->
    <line x1="16" y1="7" x2="23.79" y2="20.5" class="stroke-gray-900/25 dark:stroke-white/25" stroke-width="0.7"/>
    <line x1="23.79" y1="20.5" x2="8.21" y2="20.5" class="stroke-gray-900/25 dark:stroke-white/25" stroke-width="0.7"/>
    <line x1="8.21" y1="20.5" x2="16" y2="7" class="stroke-gray-900/25 dark:stroke-white/25" stroke-width="0.7"/>

    <!-- 中心への軸 -->
    <line x1="16" y1="7" x2="16" y2="16" class="stroke-gray-900/15 dark:stroke-white/15" stroke-width="0.4"/>
    <line x1="23.79" y1="20.5" x2="16" y2="16" class="stroke-gray-900/15 dark:stroke-white/15" stroke-width="0.4"/>
    <line x1="8.21" y1="20.5" x2="16" y2="16" class="stroke-gray-900/15 dark:stroke-white/15" stroke-width="0.4"/>

    <!-- 中心のシルバー -->
    <circle cx="16" cy="16" r="1.4" fill="#c4c9d4"/>

    <!-- 三体（黒点） -->
    <circle cx="16"    cy="7"    r="1.8" class="fill-gray-900 dark:fill-gray-100"/>
    <circle cx="23.79" cy="20.5" r="1.8" class="fill-gray-900 dark:fill-gray-100"/>
    <circle cx="8.21"  cy="20.5" r="1.8" class="fill-gray-900 dark:fill-gray-100"/>
  </svg>
</template>
