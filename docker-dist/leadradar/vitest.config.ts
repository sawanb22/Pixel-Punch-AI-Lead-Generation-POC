import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    setupFiles: ["tests/setup.ts"],
  },
  ssr: {
    external: ["node:sqlite"],
  },
});
