import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const frontendRoot = path.resolve(__dirname, '../frontend')

// Separate phone/Vercel build — does not replace Electron dist-web.
export default defineConfig({
  root: frontendRoot,
  base: '/',
  publicDir: path.resolve(frontendRoot, 'public'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png'],
      manifest: {
        name: 'Usman Biotracker',
        short_name: 'Biotracker',
        description: 'Phone view of your desktop Usman Biotracker data',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  define: {
    'import.meta.env.VITE_COMPANION': JSON.stringify('true'),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(frontendRoot, 'src'),
    },
  },
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.cjs'),
  },
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/hevy-insights': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
