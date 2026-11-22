// offline.html, which sw.js answers any failed navigation with. It must name
// its stylesheet from the site's root, since it is served at whatever address
// failed; so the build writes the base (SITE_BASE; scripts/site-params.mjs)
// into that one link. At the default base, "/", the file is byte for byte
// app/src/offline.html.
import type { APIRoute } from 'astro';
import page from '../offline.html?raw';

const LINK = 'href="/fonts/fonts.css"';
if (page.split(LINK).length !== 2) throw new Error(`app/src/offline.html must hold ${LINK} exactly once`);

export const GET: APIRoute = () =>
  new Response(page.replace(LINK, `href="${import.meta.env.BASE_URL.replace(/\/$/, '')}/fonts/fonts.css"`));
