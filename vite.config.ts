import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    esbuildOptions: { target: ["chrome120", "firefox120", "safari17"] },
  },
  build: {
    outDir: "dist/client",
    target: ["chrome120", "firefox120", "safari17"],
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          board: ["@dnd-kit/core", "@dnd-kit/sortable"],
          data: ["@tanstack/react-query", "socket.io-client"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4100",
      "/socket.io": { target: "http://127.0.0.1:4100", ws: true },
    },
  },
});
