import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// `vite build --mode store` is the Chrome Web Store build: the same extension without the
// research study (__STUDY__ in src/build.d.ts). Every other build — dist/, the checks, the
// testers' zip — has it.
export default defineConfig(({ mode }) => {
  const study = mode !== 'store';
  let outDir = 'dist';
  return {
    plugins: [
      crx({ manifest }),
      // The sweep page's link to the study pages, which the store build does not have.
      { name: 'no-study-link', transformIndexHtml: (html: string) => (study ? html : html.replace(/\s*<p class="study" id="study">[\s\S]*?<\/p>/, '')) },
      {
        // CRXJS lists the content script as web-accessible, so any site could detect the
        // extension, and its version from the file name, by fetching it. The manifest injects
        // it and it imports nothing, so nothing needs that (security review, 10 Nov).
        name: 'no-web-accessible-resources',
        apply: 'build',
        enforce: 'post',
        configResolved: (c) => void (outDir = resolve(c.root, c.build.outDir)),
        closeBundle() {
          const file = resolve(outDir, 'manifest.json');
          const m = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
          if (!('web_accessible_resources' in m)) return;
          delete m.web_accessible_resources;
          writeFileSync(file, JSON.stringify(m, null, 2));
        },
      },
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
