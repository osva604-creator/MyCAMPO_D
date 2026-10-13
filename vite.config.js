import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({ plugins: [react(), tailwindcss(), VitePWA({
  registerType: 'prompt',
  includeAssets: ['icon-192.png', 'icon-512.png'],
  manifest: {
    name: 'MyCAMPO_D', short_name: 'MyCAMPO_D', description: 'Incidencias y tareas del campo, incluso sin conexión.',
    lang: 'es-AR', start_url: '/', scope: '/', display: 'standalone', background_color: '#f6f8f5', theme_color: '#166534',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  },
  workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], cleanupOutdatedCaches: true, navigateFallback: 'index.html' },
})] });
