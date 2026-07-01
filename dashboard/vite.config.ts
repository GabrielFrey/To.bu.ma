import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the backend to avoid CORS during dev.
      '/v1': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});
