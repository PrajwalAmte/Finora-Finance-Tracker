/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { routePriceRequest } from './api/_lib/priceProxy';

/**
 * Two builds from one codebase:
 *   vite build              → dist/      bundled into the Android/iOS apps by Capacitor
 *   vite build --mode pwa   → dist-pwa/  installable web app with a service worker, deployed to
 *                                        Vercel together with the api/ price functions
 */
/**
 * Serves the same /api price routes that Vercel runs in production, so `npm run dev` and
 * `npm run preview:pwa` get live prices without the Vercel CLI.
 */
function localPriceApi(): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const response = await routePriceRequest(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers }));
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  };
  return { name: 'finora-local-price-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => {
  const pwa = mode === 'pwa';
  return {
    plugins: [
      react(),
      localPriceApi(),
      VitePWA({
        // In native builds the virtual:pwa-register module still resolves, but to a no-op.
        disable: !pwa,
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/favicon-64.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Finora — private money tracker',
          short_name: 'Finora',
          description: 'Investments, SIPs, loans, spending and capital-gains tax, encrypted on your device. No account.',
          id: '/',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0b0f19',
          theme_color: '#2563EB',
          categories: ['finance', 'productivity'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Precache everything, including pdf.js and SheetJS, so imports work offline.
          globPatterns: ['**/*.{js,mjs,css,html,png,svg,webmanifest}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          // Price responses are cached by the app itself; the service worker never stores them.
          runtimeCaching: [],
        },
      }),
    ],
    // Capacitor serves the bundle from the app's local origin, so native assets must be relative.
    base: pwa ? '/' : './',
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    build: {
      target: 'es2022',
      outDir: pwa ? 'dist-pwa' : 'dist',
      chunkSizeWarningLimit: 1500,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    },
  };
});
