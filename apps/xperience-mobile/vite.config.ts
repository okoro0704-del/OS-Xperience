import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  preview: { port: 5175 },
  optimizeDeps: {
    include: ["@digiconomy/xperience-contract", "@digiconomy/xperience-sdk"],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
