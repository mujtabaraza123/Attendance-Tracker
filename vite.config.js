import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { app as apiApp } from './server.js'

// Vite plugin to embed the Supabase Express API directly into Vite dev server
function supabaseApiPlugin() {
  return {
    name: 'supabase-api-middleware',
    configureServer(server) {
      server.middlewares.use(apiApp);
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    supabaseApiPlugin()
  ],
  server: {
    port: 5173,
    host: true
  }
})
