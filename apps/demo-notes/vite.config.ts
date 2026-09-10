import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __OSSHELL_PRODUCTION__: mode === "production",
  },
  resolve: {
    alias: {
      "@osshell/sdk": path.resolve(root, "../../packages/sdk/src/index.ts"),
      "@osshell/contract": path.resolve(root, "../../packages/contract/src/index.ts"),
    },
  },
  server: {
    port: 5185,
    host: "127.0.0.1",
    strictPort: true,
  },
}));
