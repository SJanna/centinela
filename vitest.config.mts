import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "eval/**/*.test.ts", "dataset/**/*.test.ts", "redteam/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
