import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Generate bundle analysis report when ANALYZE=true
    mode === 'analyze' &&
      visualizer({
        filename: './dist/stats.html',
        open: false,
        gzipSize: true,
        brotliSize: true,
        template: 'treemap', // or 'sunburst', 'network'
      }),
  ].filter(Boolean),
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
      // Live bracket updates. Same-origin so the session cookie rides
      // along on the upgrade request.
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    manifest: 'manifest.json',
    // Warn on chunks larger than these sizes (in KB)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual chunk splitting to ensure heavyweight libs are separate
        manualChunks(id) {
          // Keep xlsx separate (already dynamically imported)
          if (id.includes('node_modules/xlsx')) {
            return 'vendor-xlsx';
          }
          // Keep jsPDF separate (already dynamically imported)
          if (id.includes('node_modules/jspdf')) {
            return 'vendor-jspdf';
          }
          // Core vendor bundle for shared dependencies
          if (id.includes('node_modules')) {
            // Group React and core libraries together
            if (
              id.includes('react') ||
              id.includes('react-dom') ||
              id.includes('react-router') ||
              id.includes('scheduler')
            ) {
              return 'vendor-react';
            }
            // Group TanStack Query
            if (id.includes('@tanstack')) {
              return 'vendor-query';
            }
            // Everything else goes to vendor
            return 'vendor-core';
          }
        },
      },
    },
  },
}));
