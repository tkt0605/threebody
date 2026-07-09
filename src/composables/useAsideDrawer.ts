import { ref } from 'vue'

// Aside（ハンバーガーメニューで開閉するオフキャンバスドロワー）の開閉状態。
// Header と Aside はコンポーネント階層上の兄弟のため、module-level singleton で共有する。
const asideOpen = ref(false)

function openAside() { asideOpen.value = true }
function closeAside() { asideOpen.value = false }
function toggleAside() { asideOpen.value = !asideOpen.value }

export function useAsideDrawer() {
  return { asideOpen, openAside, closeAside, toggleAside }
}
