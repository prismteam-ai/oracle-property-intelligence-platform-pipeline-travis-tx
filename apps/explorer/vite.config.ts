import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/mcp": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
});
