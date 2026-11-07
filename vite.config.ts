import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
    proxy: { "/api": "http://127.0.0.1:4318" },
  },
  build: { chunkSizeWarningLimit: 1000, copyPublicDir: false },
});
