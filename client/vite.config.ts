import { defineConfig } from 'vite';

const apiProxy = { '/api': 'http://localhost:3001' };

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
