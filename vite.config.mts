import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome122",
    chunkSizeWarningLimit: 1500
  },
  server: { port: 5173, strictPort: true }
});
