// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ahmdgameel.github.io',
  vite: {
    optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  },
});
