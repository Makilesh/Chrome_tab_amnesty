/**
 * Design preview: the real sweep page (src/ui/sweep/index.html and sweep.ts, unchanged) in an
 * ordinary browser tab, on made-up tabs, with no extension loaded. For design work and for the
 * README screenshots; the extension build never includes it.
 *
 *   npm run preview        then open the printed address (add ?empty for a first visit)
 *
 * boot.ts stands in for Chrome's extension APIs and fills the database with tools/preview/data.ts
 * before the page's own script runs. Site icons come from a stand-in for Chrome's _favicon
 * endpoint below: a letter on a colour picked from the site's name, never a request to the site.
 */
import { defineConfig, type Plugin } from 'vite';

function hue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** GET /_favicon/?pageUrl=…: what the extension asks Chrome for, drawn here instead. */
const favicons: Plugin = {
  name: 'preview-favicons',
  configureServer(server) {
    server.middlewares.use('/_favicon/', (req, res) => {
      const page = new URL(req.url ?? '', 'http://x').searchParams.get('pageUrl') ?? '';
      let host = '';
      try {
        host = new URL(page).hostname.replace(/^www\./, '');
      } catch {
        // not a web page: Chrome would answer with its plain page icon
      }
      const letter = (host.split('.').at(-2) ?? host)[0]?.toUpperCase() ?? '';
      const svg = host
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl(${hue(host)} 55% 45%)"/><text x="16" y="22.5" font-family="Segoe UI, system-ui, sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`
        : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="7" y="4" width="18" height="24" rx="3" fill="none" stroke="#999" stroke-width="2.5"/></svg>';
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(svg);
    });
  },
};

/** The page's own script runs after boot.ts has stood in for chrome.* and filled the database. */
const boot: Plugin = {
  name: 'preview-boot',
  transformIndexHtml(html, ctx) {
    if (!ctx.path.endsWith('/src/ui/sweep/index.html')) return html;
    return html
      .replace('<script type="module" src="./sweep.ts"></script>', '<script type="module" src="/tools/preview/boot.ts"></script>')
      .replace(/\s*<p class="study" id="study">[\s\S]*?<\/p>/, ''); // as in the store build (vite.config.ts)
  },
};

export default defineConfig({
  root: '.',
  define: { __BUILD_ID__: '1', __STUDY__: 'false' },
  plugins: [favicons, boot],
  server: { port: 4173, strictPort: false, open: false },
});
