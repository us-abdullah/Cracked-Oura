import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopSrc = path.resolve(__dirname, '../frontend/src');
const webReact = path.resolve(__dirname, './node_modules/react');
const webReactDom = path.resolve(__dirname, './node_modules/react-dom');

/**
 * Visual mirror of the desktop app.
 * - `@` → frontend/src (same UI — desktop edits auto-appear here)
 * - Default: live desktop backend at :8000 (real Recovery / Health / Hevy)
 * - Optional: VITE_WEB_MOCK=1 for offline demo fixtures (Vercel without API)
 * - React deduped to one copy (shared src across folders)
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const useMock = env.VITE_WEB_MOCK === '1';

  const alias = [
    ...(useMock
      ? [
          {
            find: '@/lib/api',
            replacement: path.resolve(__dirname, './src/mockApi.ts'),
          },
          {
            find: '@/components/HevyInsightsEmbed',
            replacement: path.resolve(__dirname, './src/TrainingMirror.tsx'),
          },
        ]
      : []),
    {
      find: '@',
      replacement: desktopSrc,
    },
    { find: 'react-dom/client', replacement: path.resolve(webReactDom, 'client.js') },
    { find: 'react-dom', replacement: webReactDom },
    {
      find: 'react/jsx-dev-runtime',
      replacement: path.resolve(webReact, 'jsx-dev-runtime.js'),
    },
    { find: 'react/jsx-runtime', replacement: path.resolve(webReact, 'jsx-runtime.js') },
    { find: 'react', replacement: webReact },
  ];

  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      alias,
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@radix-ui/react-scroll-area',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-popover',
        '@radix-ui/react-select',
        '@radix-ui/react-switch',
      ],
    },
    server: {
      port: 5174,
      host: true,
      fs: {
        allow: [path.resolve(__dirname, '..')],
      },
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
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
