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
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
    fs: {
      allow: [repoRoot, frontendRoot],
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@protobufjs\/inquire$/,
        replacement: resolve(webSourceRoot, "lib/proto/browser-inquire.cjs"),
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
