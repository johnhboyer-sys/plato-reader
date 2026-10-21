// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Published on GitHub Pages at the root of plato.johnhboyer.com (John,
  // 2026-10-21); app/public/CNAME holds the domain so every deploy keeps it,
  // and the old johnhboyer-sys.github.io/plato-reader/ URLs redirect here.
  // `base` prefixes every app
  // path; app code reads import.meta.env.BASE_URL so it works at any base.
  // `site` is the canonical origin — set only so @astrojs/sitemap can emit
  // absolute URLs (site + base + path). App UI still uses base-relative URLs,
  // not Astro.site, so this changes no existing links.
  site: 'https://plato.johnhboyer.com',
  base: '/',
  // Astro 7 defaults to 'jsx', which drops the whitespace between inline
  // elements: prose that breaks a line at a link or <em> loses its space
  // ("the <a>Greek–English" printed as "theGreek–English"). `true` is the
  // Astro 6 behaviour the templates were written against.
  compressHTML: true,
  integrations: [
    svelte(),
    sitemap(),
  ],
  vite: {
    server: {
      fs: { allow: ['..'] },
    },
    resolve: {
      // The reader core (components, libs, global.css) lives in ../shared and
      // is consumed by both this site and the desktop app. See shared/README.md.
      alias: {
        '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
      },
    },
  },
});