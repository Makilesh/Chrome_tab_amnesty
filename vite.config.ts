import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  // One id per build, in the worker and in every page alike. Chrome keeps running the worker it
  // registered until the extension is reloaded, while pages load whatever is on disk; the sweep
  // page compares the two and says how to finish an update (DECISIONS 2026-10-17).
  define: { __BUILD_ID__: JSON.stringify(Date.now()) },
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
