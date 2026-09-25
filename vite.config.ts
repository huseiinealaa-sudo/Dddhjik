import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GitHub Pages serves the site from `https://<user>.github.io/<repo>/`, so every
 * asset URL must carry the repository name as a prefix.
 *
 * CI exports VITE_BASE from `${{ github.event.repository.name }}`, which keeps
 * the build correct after a rename. Local `npm run dev` / `npm run build` fall
 * back to a relative base so the output also works from any static folder.
 */
const base = process.env.VITE_BASE ?? './';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // iPadOS 15+ Safari is the oldest browser we target.
    target: ['es2020', 'safari15'],
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Vendor code changes far less often than the simulator, so give the
        // browser a chance to keep it cached between deployments.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
