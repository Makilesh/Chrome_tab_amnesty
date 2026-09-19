import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Pages not referenced from the manifest still need to be bundled.
      input: {
        xray: 'src/ui/xray/index.html',
        dev: 'src/ui/dev/index.html',
        sweep: 'src/ui/sweep/index.html',
        offscreen: 'src/offscreen/index.html',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
