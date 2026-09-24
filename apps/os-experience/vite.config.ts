import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs are required for Capacitor bundled WebView origins.
  base: "./",
  server: { port: 5176 },
  preview: { port: 5176 },
  optimizeDeps: {
    include: ["@digiconomy/xperience-contract", "@digiconomy/xperience-sdk"],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
