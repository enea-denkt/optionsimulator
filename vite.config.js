import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
// `base` defaults to the GitHub Pages path. To build for the gammalift member
// area instead: VITE_BASE=/member/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE || '/optionsimulator/',
  plugins: [react()],
  server: {
    allowedHosts: true,
    proxy: {
      // Cboe's public delayed-quotes CDN needs no API key, but only allows
      // cross-origin reads from cboe.com. In local dev the Vite server fetches
      // it server-side, so the browser sees a same-origin response.
      '/cboe': {
        target: 'https://cdn.cboe.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/cboe/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  build: {
    rollupOptions: {
      // index.html so GitHub Pages serves the app at the directory URL.
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
})
