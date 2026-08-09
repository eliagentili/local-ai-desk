import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the app config carries the Tauri dev server
// and the React plugin, neither of which a headless test run needs.
export default defineConfig({
  test: {
    // Node by default, so the pure modules cost nothing to test. The files that
    // need a DOM ask for one with a `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
