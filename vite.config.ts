import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  optimizeDeps: {
    include: ['skinview3d', 'three'],
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        onstart(args) { args.startup(); },
        vite: {
          build: {
            outDir: 'dist/main',
            minify: false,
            rollupOptions: {
              external: [
                'electron',
                'node:path',
                'node:fs',
                'node:os',
                'node:child_process',
                '@xmcl/core',
                '@xmcl/installer',
                '@xmcl/user',
                '@xmcl/unzip',
                'electron-conf',
              ],
            },
          },
        },
      },
      {
        entry: 'src/preload/preload.ts',
        onstart(args) { args.reload(); },
        vite: {
          build: {
            outDir: 'dist/preload',
            minify: false,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
});