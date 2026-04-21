import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/mempool': {
        target: 'https://mempool.space',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/mempool/, '/api'),
      },
      '/api/blockstream': {
        target: 'https://blockstream.info',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/blockstream/, '/api'),
      },
    },
  },
  preview: {
    proxy: {
      '/api/mempool': {
        target: 'https://mempool.space',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/mempool/, '/api'),
      },
      '/api/blockstream': {
        target: 'https://blockstream.info',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/blockstream/, '/api'),
      },
    },
  },
})
