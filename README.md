# ahmdgameel.github.io

The portfolio of **Ahmed Gameel**, Data Engineer. Live at **https://ahmdgameel.github.io**.

It reads in 30 seconds for a recruiter and holds up for an hour with an engineer. A switch in the
header changes the depth of the whole page:

- **Recruiter view** (default): role, current company, education, certificate and resume in the
  first screen, plain language everywhere.
- **Engineer view**: design decisions, metric lineage, the evidence matrix, the quality gate, the
  run history and a SQL console over the published tables.

## What makes it different

- **A live map of Egypt drawn by 10,192 cell towers.** The hero replays my Tower Health Stream
  project in the browser: a port of `tower_simulator.py` and of the Flink SQL rules in
  `anomaly_detection.py`, running at the real rate of 2,038 events per second, with 10 minute
  tumbling windows replayed 60x.
- **Every number has lineage.** Each metric links to the file in the project repo it came from and
  says how it was measured. The build fails if a featured metric has no source.
- **Skills ranked by evidence, not by stars.** Each skill sits in the strongest column it can prove:
  used at work, shipped in a public repo, or trained on.
- **The site is a pipeline.** A daily GitHub Action extracts, transforms, runs blocking quality
  checks and only then publishes. The status board judges freshness against a 26 hour SLA in the
  visitor's browser, so a missed run is visible.
- **Command palette** with Ctrl K, a night and a day theme, and a print stylesheet for recruiters
  who save the page as PDF.

## Architecture

```mermaid
flowchart LR
    A[profile.yaml] --> P[pipeline/run.py]
    B[GitHub REST API] --> P
    H[live site runs.json] --> P
    T[towers_clean.csv or illustrative model] --> P
    P --> Q{quality gate}
    Q -- fail --> X[run stops, nothing deployed]
    Q -- pass --> PQ[public/data: Parquet + row JSON]
    Q -- pass --> TB[public/data/towers.bin]
    Q -- pass --> J[src/data/*.json]
    J --> S[Astro static build]
    PQ --> S
    TB --> S
    S --> C[copy check]
    C --> G[GitHub Pages]
    PQ -. loaded by .-> D[DuckDB-WASM in the browser]
    TB -. drawn by .-> M[canvas map]
```

The run history needs no database: each deploy publishes `/data/runs.json`, and the next run reads it
back from the live site before appending its own row.

## The tower layer

`pipeline/sources/towers_clean.csv` holds the 10,192 Egyptian towers (OpenCelliD, MCC 602), cleaned by
`simulator/data_cleaner.py` in the tower-health-stream repo. Tower locations are from
[OpenCelliD](https://opencellid.org), licensed CC BY-SA 4.0.

`pipeline/sources/tower_health_stream/` holds the CSV exports of two dbt models from the same project,
`operator_performance` and `regional_risk_index`. They power the batch results on the case study page
and are queryable in the console.

On every build the quality gate checks that:

- every tower sits inside Egypt's bounding box and belongs to a known operator,
- the natural key `(radio, operator, area, cell)` is unique (cell ids alone repeat across areas),
- the tower count claimed on the site equals the rows in the data,
- the dbt outputs reconcile with the raw towers, per operator and per area.

Without the CSV the map falls back to an illustrative model and says so on screen.

## Stack

- **Site:** Astro, TypeScript, plain CSS, Canvas and SVG. No UI framework.
- **Fonts:** Archivo (variable width) for display, Geist for text, Martian Mono for data.
- **SQL engine:** `@duckdb/duckdb-wasm`, fetched only when the console scrolls into view in the
  engineer view. Tables load from row JSON, which DuckDB-WASM reads natively, so no extension is
  downloaded at runtime.
- **Pipeline:** Python and DuckDB, writing ZSTD compressed Parquet.
- **CI/CD:** GitHub Actions to GitHub Pages, every push and every morning at 06:00 UTC, with a
  keepalive so GitHub never disables the schedule.

## Edit the content

Everything about me lives in [`pipeline/sources/profile.yaml`](pipeline/sources/profile.yaml).
Change it, push, and the pipeline does the rest.

## Run locally

```bash
pip install -r pipeline/requirements.txt
npm install
npm run pipeline   # extract, validate, load
npm run dev        # http://localhost:4321
```

`python3 pipeline/run.py --offline` uses the cached GitHub snapshot when there is no network.

The share card and app icons are rendered from the built site:

```bash
npm run build && npx astro preview &
node pipeline/tools/og.mjs   # needs Playwright
```
