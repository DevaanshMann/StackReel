import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
