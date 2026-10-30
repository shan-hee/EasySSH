import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import wails from "@wailsio/runtime/plugins/vite";
import { appSingletonDependencies, appSourceAliases } from "@easyssh/app/vite";
import { chunkOutput } from "@easyssh/frontend-tooling/code-splitting";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      output: chunkOutput,
      checks: {
        pluginTimings: false,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9345,
    strictPort: true,
  },
  resolve: {
    dedupe: appSingletonDependencies,
    alias: appSourceAliases,
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  optimizeDeps: {
    entries: ["src/main.tsx"],
  },
  plugins: [react(), wails("./bindings")],
});
