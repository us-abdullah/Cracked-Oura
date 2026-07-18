import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

// Built for embedding inside Usman Biotracker at /hevy-insights/
export default defineConfig({
  plugins: [vue()],
  base: "/hevy-insights/",
  server: {
    port: 5174,
    proxy: {
      "/api/hi": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
