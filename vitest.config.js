import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.js"],
    restoreMocks: true,
    include: ["src/**/*.{test,spec}.{js,ts}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage/frontend",
      include: ["src/**/*.{js,vue}"],
      exclude: [
        "src/main.js", // Application bootstrap; production build verifies imports.
        "src/router/index.js", // Declarative route mapping.
        "src/test/**",
        "src/**/__tests__/**",
        "src/**/*.{test,spec}.{js,ts}",
        // Static documentation. Interactive help/navigation remains included.
        "src/features/help/components/AcknowledgementsSection.vue",
        "src/features/help/components/ExportGuideSection.vue",
        "src/features/help/components/FrakturReferenceSection.vue",
        "src/features/help/components/GettingStartedSection.vue",
        "src/features/help/components/ReviewTipsSection.vue",
        "src/features/help/components/SettingsReferenceSection.vue",
      ],
      // Modest goals for this suite
      thresholds: { lines: 70, statements: 70, branches: 75, functions: 70 },
    },
  },
});
