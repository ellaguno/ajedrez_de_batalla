import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const apiProxy = {
  '/api': { target: 'http://localhost:3001', ws: true },
  '/usersets': 'http://localhost:3001',
  // El catálogo de sets lo genera el servidor (fusiona builtin + subidos).
  '/sets/index.json': 'http://localhost:3001',
};

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
