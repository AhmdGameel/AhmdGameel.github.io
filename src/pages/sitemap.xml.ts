import type { APIRoute } from 'astro';
import { projects, pipelineRun } from '../lib/data';

const site = 'https://ahmdgameel.github.io';

export const GET: APIRoute = () => {
  const lastmod = pipelineRun.started_at.slice(0, 10);
  const paths = ['/', ...projects.filter((p) => p.featured).map((p) => `/projects/${p.id}/`)];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((p) => `  <url><loc>${site}${p}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
