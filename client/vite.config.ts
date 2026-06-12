import { defineConfig } from 'vite';

const apiProxy = { '/api': { target: 'http://localhost:3001', ws: true } };

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
