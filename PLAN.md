# ahmdgameel.github.io: Build Plan

## The idea

Most developer portfolios are a template (hero, cards, contact) or a fake terminal.
This one is a **working data platform**. The site is built by a real pipeline, and every
section is a stage of that pipeline, following the medallion layout Ahmed uses at work.

| Stage | Section | What the visitor sees |
|---|---|---|
| `source` | Hero | A live stream topology. Records flow through operators and materialize Ahmed's name. |
| `bronze` | About | Raw record of who Ahmed is. Photo rendered as a dot matrix that resolves on hover. |
| `silver` | Experience | An Airflow style grid view: one row per role, one cell per month, current role still "running". |
| `gold` | Projects | Each project published as a data contract with SLAs, plus an animated topology of its architecture. |
| `serving` | Query | A real SQL engine (DuckDB-WASM) in the browser. Visitors query Ahmed's profile as Parquet tables. |
| `sink` | Contact | A Kafka producer form. "Produce" a message to the `hire-ahmed` topic (opens email). |
| `observability` | Footer | Real run stats of the pipeline that built the page: run id, duration, rows, checks passed. |

A sticky lineage rail on the left tracks scroll position as a DAG.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Site | Astro + TypeScript | Static output, near zero JS by default |
| Interactivity | Vanilla TS + Canvas + SVG | No framework weight, fully custom visuals |
| Styling | Plain CSS with design tokens | Light and dark themes, no utility soup |
| SQL in browser | `@duckdb/duckdb-wasm` | Real OLAP engine, lazy loaded on demand |
| Pipeline | Python + DuckDB | Extract (YAML + GitHub API), transform, quality checks, load Parquet |
| Schedule and deploy | GitHub Actions (push + daily cron) to GitHub Pages | Free, and the site refreshes itself every day |

## Phases

1. **Foundation**: plan, repo, Astro scaffold, design tokens, fonts, layout shell.
2. **Data layer**: `pipeline/sources/profile.yaml` curated from the CV, Python pipeline
   that pulls GitHub repos, runs quality checks (including "no em dash anywhere"),
   and writes Parquet + JSON consumed by the site.
3. **Sections**: hero stream, about, experience grid, project contracts, query console, producer form, footer.
4. **Polish**: motion, reduced motion support, mobile layout, dark mode, SEO and Open Graph, accessibility.
5. **Ship**: GitHub repo `AhmdGameel/AhmdGameel.github.io`, Actions workflow, Pages deploy, verification.

## Content rules

- English only.
- No em dashes anywhere. Enforced by a pipeline quality check and a build time scan.
