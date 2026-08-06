// vitest.config.ts・設計
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        include: [
            "src/composables/__tests__/**/*.test.ts",
            "backend/tests/**/*.test.ts"
        ]
    }
})
