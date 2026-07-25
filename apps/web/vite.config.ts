import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The app calls same-origin /api/* in dev and prod alike, so nothing in the
    // client needs to know the API's address.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/provider': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
