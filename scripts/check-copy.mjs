// Fails the build if the shipped site contains an em dash or Arabic text.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['dist'];
const exts = new Set(['.html', '.js', '.css', '.json', '.xml', '.txt', '.md']);
const rules = [
  { name: 'em dash', re: /\u2014/g },
  { name: 'spaced en dash', re: /\s\u2013\s/g },
  { name: 'arabic text', re: /[؀-ۿ]/g },
];

const hits = [];
function walk(p) {
  for (const f of readdirSync(p)) {
    const full = join(p, f);
    if (statSync(full).isDirectory()) { if (f !== 'node_modules') walk(full); continue; }
    if (!exts.has(extname(f))) continue;
    // Third party bundles (DuckDB) are not our copy.
    if (/duckdb/i.test(f)) continue;
    const text = readFileSync(full, 'utf8');
    for (const r of rules) {
      for (const m of text.matchAll(r.re)) {
        hits.push(`${full}: ${r.name} near "${text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ')}"`);
      }
    }
  }
}
roots.forEach(walk);
if (hits.length) {
  console.error(`copy check failed (${hits.length}):\n` + hits.join('\n'));
  process.exit(1);
}
console.log(`copy check passed: no em dashes or non English text in ${roots.join(', ')}`);
