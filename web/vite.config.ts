import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopSrc = path.resolve(__dirname, '../frontend/src');
const webNm = path.resolve(__dirname, 'node_modules');
const webReact = path.resolve(webNm, 'react');
const webReactDom = path.resolve(webNm, 'react-dom');

/**
 * Shared frontend/src imports resolve packages from frontend/node_modules,
 * which does not exist on Vercel (only web/ is installed). Re-resolve bare
 * imports from desktop source against web/node_modules instead.
 */
function resolveDesktopDepsFromWeb(): Plugin {
  return {
    name: 'resolve-desktop-deps-from-web',
    async resolveId(id, importer, options) {
      if (!importer) return null;
      const norm = importer.replace(/\\/g, '/');
      if (!norm.includes('/frontend/src/')) return null;
      // Relative / virtual / already-aliased @/ paths: leave alone
      if (
        id.startsWith('\0') ||
        id.startsWith('.') ||
        id.startsWith('/') ||
        id.startsWith('@/') ||
        path.isAbsolute(id)
      ) {
        return null;
      }
      return this.resolve(id, path.join(__dirname, 'index.html'), {
        ...options,
        skipSelf: true,
      });
    },
  };
}

/** Pin every runtime dependency to web/node_modules (belt + suspenders). */
function dependencyAliases() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
  ) as { dependencies?: Record<string, string> };
  const names = Object.keys(pkg.dependencies || {}).filter(
    (n) => n !== 'react' && n !== 'react-dom'
  );
  return names.map((name) => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    replacement: path.resolve(webNm, name),
  }));
}

/**
 * Visual mirror of the desktop app.
 * - `@` → frontend/src (same UI — desktop edits auto-appear here)
 * - Default (dev): live desktop backend at :8000
 * - VITE_WEB_SNAPSHOT=1 (Vercel): real data from /mirror-snapshot.json
 * - VITE_WEB_MOCK=1: offline demo fixtures only
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const useMock = env.VITE_WEB_MOCK === '1';
  const useSnapshot =
    !useMock &&
    (env.VITE_WEB_SNAPSHOT === '1' || mode === 'production');

  const apiShim = useMock
    ? path.resolve(__dirname, './src/mockApi.ts')
    : useSnapshot
      ? path.resolve(__dirname, './src/snapshotApi.ts')
      : null;

  const alias = [
    ...(apiShim
      ? [
          {
            find: '@/lib/api',
            replacement: apiShim,
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
    ...dependencyAliases(),
  ];

  return {
    plugins: [resolveDesktopDepsFromWeb(), react()],
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
        'lucide-react',
        'date-fns',
        'chart.js',
        'recharts',
        'react-grid-layout',
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
      // Ensure CSS from shared frontend is scanned (tailwind content already set)
      commonjsOptions: {
        include: [/node_modules/],
      },
    },
  };
});
