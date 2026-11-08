import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // librerías en archivos aparte: el navegador las guarda en caché y no se vuelven a bajar en cada despliegue
    rollupOptions: { output: { manualChunks: { react: ["react", "react-dom", "react-router-dom"], http: ["axios"] } } },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
