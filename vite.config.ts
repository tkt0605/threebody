// vite.config.ts・設計
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_BASE_URL || 'http://localhost:3000'

  return {
    plugins: [
      vue(),
      tailwindcss(),
    ],
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
