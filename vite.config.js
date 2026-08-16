import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite plugin to embed the Supabase Express API directly into Vite dev server
function supabaseApiPlugin() {
  return {
    name: 'supabase-api-middleware',
    async configureServer(server) {
      const { app } = await import('./server.js');
      server.middlewares.use(app);
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

