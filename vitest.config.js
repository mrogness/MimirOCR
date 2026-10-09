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
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage/frontend",
      include: ["src/**/*.{js,vue}"],
      exclude: ["src/main.js", "src/test/**", "src/**/*.{test,spec}.{js,ts}"],
    },
  },
});
