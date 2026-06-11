import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(frontendRoot, "../../..");
const workspacePackage = resolve(repoRoot, "web/packages/ssh-workspace/src/desktop.ts");
const webSourceRoot = `${resolve(repoRoot, "web/src")}/`;
const webNodeModulesRoot = resolve(repoRoot, "web/node_modules");
const webI18next = resolve(webNodeModulesRoot, "i18next/dist/esm/i18next.js");
const webReactI18next = resolve(webNodeModulesRoot, "react-i18next/dist/es/index.js");
const webRoot = resolve(repoRoot, "web");
const webRequire = createRequire(resolve(webRoot, "package.json"));
const tailwindPostcss = webRequire("@tailwindcss/postcss");

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: "node_modules/.vite-desktop",
  build: {
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9345,
    strictPort: true,
    fs: {
      allow: [repoRoot, frontendRoot],
    },
  },
  resolve: {
    dedupe: ["react", "react-dom", "i18next", "react-i18next"],
    alias: [
      {
        find: /^@protobufjs\/inquire$/,
        replacement: resolve(webSourceRoot, "lib/proto/browser-inquire.cjs"),
      },
      {
        find: /^i18next$/,
        replacement: webI18next,
      },
      {
        find: /^react-i18next$/,
        replacement: webReactI18next,
      },
      {
        find: /^react$/,
        replacement: resolve(webNodeModulesRoot, "react/index.js"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: resolve(webNodeModulesRoot, "react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: resolve(webNodeModulesRoot, "react/jsx-dev-runtime.js"),
      },
      {
        find: /^react-dom$/,
        replacement: resolve(webNodeModulesRoot, "react-dom/index.js"),
      },
      {
        find: /^react-dom\/client$/,
        replacement: resolve(webNodeModulesRoot, "react-dom/client.js"),
      },
      {
        find: /^react-router-dom$/,
        replacement: resolve(webNodeModulesRoot, "react-router-dom/dist/index.mjs"),
      },
      {
        find: /^@easyssh\/ssh-workspace\/desktop$/,
        replacement: workspacePackage,
      },
      {
        find: /^@\//,
        replacement: webSourceRoot,
      },
    ],
  },
  css: {
    postcss: {
      plugins: [
        tailwindPostcss({ base: webRoot }),
      ],
    },
  },
  optimizeDeps: {
    entries: [
      "src/main.tsx",
      "../../../web/packages/ssh-workspace/src/desktop.ts",
    ],
  },
  plugins: [react(), wails("./bindings")],
});
