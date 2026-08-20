// vitest.config.ts・設計
import { defineConfig  } from "vitest/config";
export default defineConfig({
    test: {
        environment: "jsdom",
        include: [
            "src/composables/__tests__/**/*.test.ts",
            "backend/tests/**/*.test.ts"
        ],
        // src/lib/supabase.ts は import された時点で createClient() を呼ぶため、
        // VITE_SUPABASE_* が無い環境（＝.env を持たないCI）では useChat を import しただけで
        // "supabaseUrl is required." で落ちる。手元では .env が読まれて通ってしまい、
        // CIだけが落ちるという分かりにくい状態になっていた。
        // ここでダミー値を固定しておくことで、(1) CIでも import が通り、
        // (2) 手元の実プロジェクトの認証情報がテストへ漏れない（＝テストが本番Supabaseを
        // 誤って叩くことがない）の両方を満たす。テストはSupabaseへの通信をすべてモックする前提。
        env: {
            VITE_SUPABASE_URL: "http://localhost:54321",
            VITE_SUPABASE_ANON_KEY: "test-anon-key",
        },
    }
})
