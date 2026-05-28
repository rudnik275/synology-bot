import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The Mini App is served as static assets by the Hono backend in production.
// In dev, Vite proxies /api to the loopback backend (MINIAPP_PORT, default 8080).
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/healthz': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
