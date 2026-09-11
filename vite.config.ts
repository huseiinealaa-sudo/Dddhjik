import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The site is published to GitHub Pages under `https://<user>.github.io/<repo>/`,
 * so every asset URL needs to be prefixed with the repository name.
 *
 * The CI workflow exports `VITE_BASE` derived from `${{ github.event.repository.name }}`
 * which keeps the build correct even if the repository is ever renamed.
 * Locally (and for `npm run dev`) we fall back to `/` so the dev server works as usual.
 */
const base = process.env.VITE_BASE ?? (process.env.NODE_ENV === 'production' ? '/Dddhjik/' : '/');

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split the two big vendor libraries out so the browser can cache them
        // independently of the simulator code.
        manualChunks: (id: string) => {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
