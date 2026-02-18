import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      // Ensure the 'shared' workspace package resolves to its TypeScript source
      // so Vite's esbuild pipeline can process it directly
      shared: path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
