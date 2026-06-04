import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(frontendRoot, "../../..");
const workspacePackage = resolve(repoRoot, "web/packages/ssh-workspace/src/desktop.ts");
const webSourceRoot = `${resolve(repoRoot, "web/src")}/`;

// https://vitejs.dev/config/
export default defineConfig({
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
        find: /^@easyssh\/ssh-workspace\/desktop$/,
        replacement: workspacePackage,
      },
      {
        find: /^@\//,
        replacement: webSourceRoot,
      },
    ],
  },
  plugins: [react(), wails("./bindings")],
});
