import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "eval/**/*.test.ts", "dataset/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    // Generar en memoria los 138 casos del dataset (fotos incluidas) en un beforeAll pasa de 10 s con
    // las demás pruebas en paralelo.
    hookTimeout: 120000,
  },
});
