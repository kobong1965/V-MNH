import fs from 'node:fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const packageVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;
  const backendUrl = env.VELA_BACKEND_URL || 'http://127.0.0.1:3001';
  const proxy = {
    '/api': {
      target: backendUrl,
      changeOrigin: true
    },
    '/library': {
      target: backendUrl,
      changeOrigin: true
    }
  };
  return {
    cacheDir: env.VELA_VITE_CACHE_DIR || 'node_modules/.vite',
    define: { __VELA_VERSION__: JSON.stringify(packageVersion) },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
