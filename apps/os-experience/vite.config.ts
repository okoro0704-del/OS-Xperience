import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cspPlugin } from "./csp";

export default defineConfig({
  plugins: [react(), cspPlugin()],
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
