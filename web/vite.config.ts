import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The showcase API (FastAPI) listens on 127.0.0.1:8710. Proxying keeps the browser on one
// origin, so the SSE stream and fetches need no CORS round-trips in development.
const API = process.env.DS_API_ORIGIN ?? 'http://127.0.0.1:8710'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/metrics': { target: API, changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5181,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/metrics': { target: API, changeOrigin: false },
    },
  },
  // pre-bundle the three.js line helpers up front so the lazy hero chunk never hits a re-optimise
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/lines/Line2.js',
      'three/examples/jsm/lines/LineGeometry.js',
      'three/examples/jsm/lines/LineMaterial.js',
      '@react-three/fiber',
    ],
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
})
