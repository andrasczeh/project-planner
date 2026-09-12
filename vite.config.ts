import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    allowedHosts: ['amd-ai'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name: 'Project Planner',
        short_name: 'Planner',
        description: 'Browser-only local-first project management tool',
        theme_color: '#0f1117',
        background_color: '#0f1117',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-72.png',
            sizes: '72x72',
            type: 'image/png',
          },
          {
            src: 'icon-96.png',
            sizes: '96x96',
            type: 'image/png',
          },
          {
            src: 'icon-128.png',
            sizes: '128x128',
            type: 'image/png',
          },
          {
            src: 'icon-144.png',
            sizes: '144x144',
            type: 'image/png',
          },
          {
            src: 'icon-152.png',
            sizes: '152x152',
            type: 'image/png',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-384.png',
            sizes: '384x384',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
})
