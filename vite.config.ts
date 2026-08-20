import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

// Vite config — see `docs/bundle-sizes.md` for the current size
// baseline and the per-chunk budgets enforced by the CI step in
// `.github/workflows/ci.yml`. We let Vite/Rollup auto-split
// (default behaviour, no manualChunks) so shared code between
// chunks isn't duplicated. The visualizer is wired so the stats
// treemap regenerates on every build; setting ANALYZE=1 also
// emits the human-readable HTML to dist/stats.html.
export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
      emitAssets: !!process.env.ANALYZE,
      projectRoot: 'src/client',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Initial-entry budget. Current main + vendor is ~463 kB
    // raw / ~150 kB gz (see docs/bundle-sizes.md). The warning
    // at 500 kB gives us ~38 kB of headroom; CI enforces the
    // same number via scripts/bundle-manifest.mjs.
    chunkSizeWarningLimit: 500,
  },
});
