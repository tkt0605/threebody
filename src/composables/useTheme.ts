import { ref, watch } from 'vue'

const isDark = ref(localStorage.getItem('theme') === 'dark')

function apply() {
  document.documentElement.classList.toggle('dark', isDark.value)
}

apply()

watch(isDark, (v) => {
  localStorage.setItem('theme', v ? 'dark' : 'light')
  apply()
})

export function useTheme() {
  return {
    isDark,
    toggle: () => { isDark.value = !isDark.value },
  }
}
