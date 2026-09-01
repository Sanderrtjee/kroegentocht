import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * De build levert alleen externe modulebestanden op, geen inline scripts. Dat is
 * nodig omdat de Content Security Policy van de api script-src op 'self' zet.
 *
 * Daarom staat injectRegister op null: de standaardinstelling zou een inline
 * scriptje in index.html zetten om de service worker te registreren, en dat zou
 * de policy overtreden. De registratie gebeurt in src/main.tsx.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      filename: 'sw.js',
      manifest: {
        name: 'Kroegentocht',
        short_name: 'Kroegentocht',
        description: 'Kroegentochten vastleggen en op de kaart zetten',
        lang: 'nl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf7f2',
        theme_color: '#faf7f2',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/tiles\//, /^\/healthz/, /^\/readyz/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Kaarttegels: in een kroeg met slechte dekking wil je de kaart die
            // je net zag nog kunnen bekijken.
            urlPattern: /^\/tiles\/.*\.png$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^\/api\/photos\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'photos',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Leesverzoeken naar de api: eerst het netwerk, en anders het laatst
            // bekende antwoord. Schrijfacties gaan nooit via de service worker,
            // die lopen via de eigen offline wachtrij in src/lib/offline-queue.ts.
            urlPattern: /^\/api\/(map|visits|crawls|people|stats)/,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-reads',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        /**
         * Leaflet los van de rest. De kaart is het zwaarste stuk en wordt niet
         * op elke pagina gebruikt; op een telefoon met slechte dekking is het
         * verschil tussen 600 kB en 400 kB bij de eerste keer laden merkbaar.
         */
        manualChunks: {
          leaflet: ['leaflet', 'leaflet.markercluster'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/tiles': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
