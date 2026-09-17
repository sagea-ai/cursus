import path from "node:path";
import { defineConfig } from "vitest/config";

// NOTE: no vite plugins here on purpose. @vitejs/plugin-react and
// vite-tsconfig-paths pull the root vite (v8) types while vitest bundles its
// own vite — the Plugin types conflict at typecheck time. Vitest transpiles
// TS/JSX via esbuild out of the box, and the only path mapping (@/*) is
// aliased manually below. Revisit if component tests ever need HMR/fast-refresh.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "lib/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
