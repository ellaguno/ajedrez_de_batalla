import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

const apiProxy = {
  '/api': { target: 'http://localhost:3001', ws: true },
  '/usersets': 'http://localhost:3001',
  '/userhdri': 'http://localhost:3001',
  // Los catálogos los genera el servidor (fusiona builtin + subidos).
  '/sets/index.json': 'http://localhost:3001',
  '/hdri/index.json': 'http://localhost:3001',
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
