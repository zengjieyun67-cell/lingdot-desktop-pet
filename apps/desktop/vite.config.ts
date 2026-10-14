import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port in dev and no screen clearing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  css: { modules: { localsConvention: "camelCase" } },
  build: {
    target: "safari15",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
} as import("vite").UserConfig & { test: unknown });
