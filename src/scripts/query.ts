/** In browser SQL over the pipeline's Parquet output, powered by DuckDB-WASM. */
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

const KEYWORDS = new Set(
  ('select from where group by order having limit as and or not in is null case when then else end join left right ' +
    'inner outer on with distinct union all asc desc like ilike between filter over partition describe show tables ' +
    'create view true false cast interval').split(' '),
);

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(sql: string) {
  const re = /(--[^\n]*)|('(?:[^']|'')*')|("(?:[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|([\s\S])/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m[1]) out += `<span class="tok-c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-s">${esc(m[2])}</span>`;
    else if (m[3]) out += esc(m[3]);
    else if (m[4]) out += `<span class="tok-n">${m[4]}</span>`;
    else if (m[5]) {
      const w = m[5];
      if (KEYWORDS.has(w.toLowerCase())) out += `<span class="tok-k">${w}</span>${m[6] ? esc(m[6]) : ''}`;
      else if (m[6]) out += `<span class="tok-f">${w}</span>${esc(m[6])}`;
      else out += esc(w);
    } else out += esc(m[7]);
  }
  // Keep a trailing newline visible so the overlay matches the textarea height.
  return out + (sql.endsWith('\n') ? ' ' : '');
}

function fmt(v: unknown): { text: string; cls: string } {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'null' };
  if (typeof v === 'bigint') return { text: v.toLocaleString('en-US'), cls: 'num' };
  if (typeof v === 'number') return { text: Number.isInteger(v) ? v.toLocaleString('en-US') : String(+v.toFixed(3)), cls: 'num' };
  if (typeof v === 'boolean') return { text: String(v), cls: 'num' };
  if (v instanceof Date) return { text: v.toISOString().slice(0, 10), cls: '' };
  if (typeof v === 'object') {
    const anyV = v as { toArray?: () => unknown[]; toJSON?: () => unknown };
    if (typeof anyV.toArray === 'function') return { text: `[${[...anyV.toArray()].map((x) => fmt(x).text).join(', ')}]`, cls: '' };
    if (typeof anyV.toJSON === 'function') return { text: JSON.stringify(anyV.toJSON(), (_, x) => (typeof x === 'bigint' ? Number(x) : x)), cls: '' };
  }
  return { text: String(v), cls: '' };
}

function typeName(t: unknown) {
  const s = String(t);
  const map: Record<string, string> = {
    Utf8: 'varchar', Int64: 'bigint', Int32: 'integer', Float64: 'double', Float32: 'float', Bool: 'boolean',
  };
  if (s.startsWith('List')) return 'list';
  if (s.startsWith('Date')) return 'date';
  if (s.startsWith('Timestamp')) return 'timestamp';
  if (s.startsWith('Decimal')) return 'decimal';
  return map[s] ?? s.toLowerCase();
}

export function initConsole() {
  const root = document.querySelector<HTMLElement>('#platform .console');
  if (!root) return;
  const ta = document.getElementById('sql') as HTMLTextAreaElement;
  const hl = document.getElementById('sql-hl')!;
  const runBtn = document.getElementById('sql-run') as HTMLButtonElement;
  const stateEl = document.getElementById('sql-state')!;
  const dot = root.querySelector<HTMLElement>('.state-dot')!;
  const results = document.getElementById('sql-results')!;
  const tables: string[] = JSON.parse(root.dataset.tables || '[]');

  const sync = () => (hl.innerHTML = highlight(ta.value));
  ta.addEventListener('input', sync);
  sync();

  let db: AsyncDuckDB | null = null;
  let conn: AsyncDuckDBConnection | null = null;
  let booting: Promise<void> | null = null;

  const setState = (state: string, text: string) => {
    dot.dataset.state = state;
    stateEl.textContent = text;
  };

  function boot() {
    if (booting) return booting;
    booting = (async () => {
      setState('loading', 'loading DuckDB into your browser, only once');
      const t0 = performance.now();
      const duckdb = await import('@duckdb/duckdb-wasm');
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
      );
      const worker = new Worker(workerUrl);
      db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      conn = await db.connect();
      setState('loading', `loading ${tables.length} tables`);
      // Row JSON is read natively by DuckDB-WASM, no extension download needed.
      await Promise.all(
        tables.map(async (t) => {
          const text = await (await fetch(new URL(`/data/${t}.json`, location.href))).text();
          await db!.registerFileText(`${t}.json`, text);
        }),
      );
      for (const t of tables) await conn.insertJSONFromPath(`${t}.json`, { name: t });
      const ver = await conn.query('SELECT version() AS v');
      const v = String(ver.toArray()[0]?.toJSON().v ?? '');
      setState('ready', `ready, duckdb ${v}, ${tables.length} tables, booted in ${Math.round(performance.now() - t0)} ms`);
      loadColumns();
    })().catch((e) => {
      booting = null;
      setState('error', 'engine failed to start, check your connection and try again');
      results.innerHTML = `<p class="err">${esc(String(e?.message || e))}</p>`;
      throw e;
    });
    return booting;
  }

  async function loadColumns() {
    for (const t of tables) {
      const el = root!.querySelector<HTMLElement>(`[data-cols="${t}"]`);
      if (!el || !conn) continue;
      const res = await conn.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`);
      el.innerHTML = res
        .toArray()
        .map((r) => {
          const o = r.toJSON() as { column_name: string; data_type: string };
          return `${esc(o.column_name)} <span style="opacity:.6">${esc(o.data_type.toLowerCase())}</span>`;
        })
        .join('<br>');
    }
  }

  let seq = 0;
  async function run(sql = ta.value) {
    const mine = ++seq;
    try { await boot(); } catch { return; }
    if (!conn || mine !== seq) return;
    const t0 = performance.now();
    try {
      const res = await conn.query(sql);
      if (mine !== seq) return; // a newer query was started, drop this result
      const ms = performance.now() - t0;
      const fields = res.schema.fields;
      const rows = res.toArray();
      if (!fields.length) {
        results.innerHTML = '<p class="empty mono faint">Statement executed. No rows returned.</p>';
      } else {
        const head = fields.map((f) => `<th>${esc(f.name)}<small>${esc(typeName(f.type))}</small></th>`).join('');
        const body = rows
          .slice(0, 500)
          .map((r, i) => {
            const cells = fields
              .map((f) => {
                const raw = r[f.name];
                const kind = typeName(f.type);
                const { text, cls } =
                  (kind === 'date' || kind === 'timestamp') && (typeof raw === 'number' || typeof raw === 'bigint')
                    ? { text: new Date(Number(raw)).toISOString().slice(0, kind === 'date' ? 10 : 16).replace('T', ' '), cls: '' }
                    : fmt(raw);
                return `<td class="${cls}">${esc(text)}</td>`;
              })
              .join('');
            return `<tr class="fresh" data-i="${Math.min(i, 12)}">${cells}</tr>`;
          })
          .join('');
        results.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
        results.querySelectorAll<HTMLElement>('tr.fresh td').forEach((td) => {
          td.style.animationDelay = `${Number(td.parentElement!.dataset.i) * 30}ms`;
        });
      }
      setState('ready', `${rows.length} row${rows.length === 1 ? '' : 's'} in ${ms.toFixed(1)} ms`);
    } catch (e: any) {
      if (mine !== seq) return;
      setState('error', 'query failed');
      results.innerHTML = `<p class="err">${esc(String(e?.message || e))}</p>`;
    }
  }

  runBtn.addEventListener('click', () => run());
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = ta;
      ta.setRangeText('  ', s, en, 'end');
      sync();
    }
  });

  const presets = root.querySelectorAll<HTMLButtonElement>('.preset');
  presets.forEach((b) =>
    b.addEventListener('click', () => {
      presets.forEach((x) => x.classList.toggle('active', x === b));
      ta.value = b.dataset.sql || '';
      sync();
      run();
    }),
  );

  root.querySelectorAll<HTMLButtonElement>('.tbl').forEach((b) =>
    b.addEventListener('click', () => {
      const t = b.dataset.table!;
      root.querySelector(`[data-cols="${t}"]`)?.classList.toggle('open');
      presets.forEach((x) => x.classList.remove('active'));
      ta.value = `SELECT *\nFROM ${t}\nLIMIT 20;`;
      sync();
      run();
    }),
  );

  // The engine is only fetched once the console is on screen, which only happens in the
  // engineer view. Recruiters never download it.
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting) { io.disconnect(); run(); }
    },
    { rootMargin: '200px 0px' },
  );
  io.observe(root);
}
