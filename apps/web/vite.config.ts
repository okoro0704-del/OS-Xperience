import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    // Fold contract development origin defaults out of production bundles.
    __OSSHELL_PRODUCTION__: mode === "production",
  },
  resolve: {
    alias: {
      "@osshell/contract": path.resolve(root, "../../packages/contract/src/index.ts"),
      "@osshell/runtime": path.resolve(root, "../../packages/runtime/src/index.ts"),
    },
  },
  server: {
    port: 5180,
    host: "127.0.0.1",
    strictPort: false,
  },
}));
