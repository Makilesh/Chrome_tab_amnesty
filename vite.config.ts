import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// `vite build --mode store` is the Chrome Web Store build: the same extension without the
// research study (__STUDY__ in src/build.d.ts). Every other build — dist/, the checks, the
// testers' zip — has it.
export default defineConfig(({ mode }) => {
  const study = mode !== 'store';
  return {
    plugins: [
      crx({ manifest }),
      // The sweep page's link to the study pages, which the store build does not have.
      { name: 'no-study-link', transformIndexHtml: (html: string) => (study ? html : html.replace(/\s*<p class="study" id="study">[\s\S]*?<\/p>/, '')) },
    ],
    define: {
      // One id per build, in the worker and in every page alike. Chrome keeps running the worker
      // it registered until the extension is reloaded, while pages load whatever is on disk; the
      // sweep page compares the two and says how to finish an update (DECISIONS 2026-10-17).
      __BUILD_ID__: JSON.stringify(Date.now()),
      __STUDY__: JSON.stringify(study),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: study,
      rollupOptions: {
        // Pages not referenced from the manifest still need to be bundled.
        input: {
          ...(study ? { xray: 'src/ui/xray/index.html', dev: 'src/ui/dev/index.html' } : {}),
          sweep: 'src/ui/sweep/index.html',
          offscreen: 'src/offscreen/index.html',
        },
      },
    },
    test: {
      include: ['src/**/*.test.ts'],
    },
  };
});
