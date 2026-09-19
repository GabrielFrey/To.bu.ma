import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ship a new service worker automatically when a new build is deployed.
      registerType: 'autoUpdate',
      // Auto-inject the registration code into the built app.
      injectRegister: 'auto',
      // Serve the SW in `vite dev` too, so the install/offline flow is testable
      // without a production build.
      devOptions: { enabled: true, type: 'module' },
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32x32.png'],
      manifest: {
        name: 'Token Budget Manager',
        short_name: 'TBM',
        description:
          'Control & optimization layer between AI agents and LLM APIs — budgets, policies, and live spend observability.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache the built app shell so it loads offline after first visit.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // The API is dynamic and tenant-scoped: serve fresh data when online,
        // fall back to the last successful response when offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tbm-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the backend to avoid CORS during dev.
      '/v1': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});
