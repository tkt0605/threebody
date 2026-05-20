// vite.config.ts・設計
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
        vue(),
        tailwindcss()
    ],
    server: {
        host: '0.0.0.0',
        strictPort: true,
        proxy: {
            "/api": {
                target: `${process.env.VITE_API_BASE_URL}`,
                changeOrigin: true
            }
        }
    }
})