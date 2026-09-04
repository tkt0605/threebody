<script setup lang="ts">
import { RouterView } from 'vue-router';
// 一時的な計測用の表示。?srdebug=1 が無ければ何も描かない（lib/srDebug.ts）
import SrDebugOverlay from './components/SrDebugOverlay.vue';

</script>

<template>
    <RouterView/>
    <SrDebugOverlay />
</template>
