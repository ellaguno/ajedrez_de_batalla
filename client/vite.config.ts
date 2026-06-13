import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

// Puerto del servidor de la API en desarrollo (ver server/src/index.ts).
const API = process.env.ADB_API_URL ?? 'http://localhost:8731';

const apiProxy = {
  '/api': { target: API, ws: true },
  '/usersets': API,
  '/userhdri': API,
  // Los catálogos los genera el servidor (fusiona builtin + subidos).
  '/sets/index.json': API,
  '/hdri/index.json': API,
};

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
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
