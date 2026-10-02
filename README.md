# ahmdgameel.github.io

The portfolio of **Ahmed Gameel**, Data Engineer. Live at **https://ahmdgameel.github.io**.

This site is not a template. It is a small data platform, and every section is a stage of the
pipeline that builds it.

| Stage | Section | What happens |
|---|---|---|
| `source` | Hero | Records stream through Kafka style partitions at 2,038 events per second and materialize the name. |
| `bronze` | About | The raw profile record. The portrait is stored as a halftone and decodes on hover. |
| `silver` | Experience | An Airflow style grid view. One row per role, one cell per month, the current role is still running. |
| `gold` | Projects | Each project is published as a data contract with SLAs and a live architecture topology. |
| `serving` | Query | DuckDB compiled to WebAssembly runs real SQL over the Parquet files in your browser. |
| `sink` | Contact | A Kafka producer form that publishes to the `hire-ahmed` topic (your mail client is the broker). |
| `observability` | Footer | Real stats from the pipeline run that built the page. |

## Architecture

```mermaid
flowchart LR
    A[profile.yaml] --> P[pipeline/run.py]
    B[GitHub REST API] --> P
    P --> Q{quality gate}
    Q -- fail --> X[run stops, nothing deployed]
    Q -- pass --> PQ[public/data/*.parquet]
    Q -- pass --> J[src/data/*.json]
    J --> S[Astro static build]
    PQ --> S
    S --> C[copy check]
    C --> G[GitHub Pages]
    PQ -. fetched by .-> D[DuckDB-WASM in the browser]
```

A GitHub Actions workflow runs on every push and every morning at 06:00 UTC.

**Quality checks** (the run fails if any of them fails): no em dashes, English only, unique ids,
valid date ranges, a single current role, topology edges that resolve, and skill levels in range.
A second check scans the built site for the same copy rules.

## Stack

- **Site:** Astro, TypeScript, plain CSS, Canvas and SVG. No UI framework.
- **SQL engine:** `@duckdb/duckdb-wasm`, lazy loaded when the visitor reaches the console.
- **Pipeline:** Python and DuckDB, writing ZSTD compressed Parquet.
- **CI/CD:** GitHub Actions to GitHub Pages.

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
