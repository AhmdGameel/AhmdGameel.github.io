"""Portfolio pipeline.

extract   profile.yaml, GitHub REST API, the run history of the live site, the tower layer
transform normalize into tables, link every skill to its evidence and every metric to its source
quality   contract checks, the run fails if any blocking check fails
load      Parquet for the in browser SQL console, JSON for the static site, a binary tower layer

Usage: python pipeline/run.py [--offline]
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path

import duckdb
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import towers as tower_layer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "pipeline" / "sources" / "profile.yaml"
TOWERS_CSV = ROOT / "pipeline" / "sources" / "towers_clean.csv"
BATCH_DIR = ROOT / "pipeline" / "sources" / "tower_health_stream"  # dbt model outputs from the project
CACHE = ROOT / "pipeline" / "cache" / "github.json"
RUNS_CACHE = ROOT / "pipeline" / "cache" / "runs.json"
SITE = "https://ahmdgameel.github.io"
PARQUET_DIR = ROOT / "public" / "data"
JSON_DIR = ROOT / "src" / "data"
HISTORY_KEEP = 90

EM_DASH = "—"
SPACED_EN_DASH = re.compile(r"\s–\s")


def log(stage: str, msg: str) -> None:
    print(f"[{stage:>9}] {msg}", flush=True)


# ---------------------------------------------------------------- extract

def http_json(url: str, timeout: int = 20) -> object:
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json" if "api.github.com" in url else "application/json")
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token and "api.github.com" in url:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def extract_github(handle: str, offline: bool) -> dict:
    if not offline:
        try:
            api = "https://api.github.com"
            user = http_json(f"{api}/users/{handle}")
            repos = http_json(f"{api}/users/{handle}/repos?per_page=100&sort=updated")
            repos = [r for r in repos if not r["fork"] and not r.get("private") and r["name"] not in (handle, "test", f"{handle}.github.io")]
            for r in repos:
                r["languages"] = http_json(f"{api}/repos/{handle}/{r['name']}/languages")
            data = {"user": user, "repos": repos, "fetched_at": now_iso()}
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(data))
            log("extract", f"github api: {len(repos)} repos")
            return data
        except Exception as exc:  # network or rate limit, fall back to the last good snapshot
            log("extract", f"github api unavailable ({exc}), using cache")
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    log("extract", "no cache, continuing with empty github snapshot")
    return {"user": {}, "repos": [], "fetched_at": None}


def extract_run_history(offline: bool) -> list[dict]:
    """The live site is the state store: each deploy publishes the history it was built with."""
    if not offline:
        try:
            runs = http_json(f"{SITE}/data/runs.json", timeout=10)
            if isinstance(runs, list):
                log("extract", f"run history from live site: {len(runs)} runs")
                return runs
        except Exception as exc:
            log("extract", f"live run history unavailable ({exc}), using cache")
    if RUNS_CACHE.exists():
        return json.loads(RUNS_CACHE.read_text())
    return []


def extract_batch() -> dict[str, list[dict]]:
    """Outputs of the dbt models in tower-health-stream, exported as CSV."""
    import csv

    def num(v: str):
        try:
            f = float(v)
            return int(f) if f.is_integer() and "." not in v else f
        except ValueError:
            return v

    out = {}
    for name in ("operator_performance", "regional_risk_index"):
        path = BATCH_DIR / f"{name}.csv"
        if path.exists():
            with path.open(newline="") as f:
                out[f"dbt_{name}"] = [{k: num(v) for k, v in r.items()} for r in csv.DictReader(f)]
    return out


# -------------------------------------------------------------- transform

def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = SPACED_EN_DASH.sub(", ", value).replace(EM_DASH, ", ")
    return re.sub(r"\s+", " ", value).strip()


def month(value) -> str | None:
    if value is None:
        return None
    return str(value)[:7]


def build_evidence(profile: dict, projects: list[dict]) -> tuple[list[dict], list[dict]]:
    aliases = profile.get("skill_aliases", {})
    norm = lambda s: aliases.get(s, s)  # noqa: E731

    sources = []
    for e in profile["experience"]:
        label = e["company"] if e["type"] == "work" else f'{e["company"]}, {e["role"]}'
        sources.append({"id": e["id"], "label": label, "kind": e["type"], "stack": {norm(s) for s in e["stack"]}})
    for p in projects:
        sources.append({"id": p["id"], "label": p["name"], "kind": "project", "stack": {norm(s) for s in p["stack"]}})

    rows = []
    for g in profile["skills"]:
        for skill in g["items"]:
            for s in sources:
                if skill in s["stack"]:
                    rows.append({"skill": skill, "category": g["group"], "evidence_id": s["id"], "evidence": s["label"], "kind": s["kind"]})
    for x in profile.get("skill_evidence", []):
        group = next(g["group"] for g in profile["skills"] if x["skill"] in g["items"])
        kind = "cert" if x["id"].startswith("cert") else "repo"
        rows.append({"skill": x["skill"], "category": group, "evidence_id": x["id"], "evidence": x["label"], "kind": kind})

    rank = {"work": 0, "project": 1, "repo": 1, "training": 2, "cert": 2}
    tiers = []
    for g in profile["skills"]:
        for skill in g["items"]:
            kinds = [r["kind"] for r in rows if r["skill"] == skill]
            best = min((rank[k] for k in kinds), default=3)
            tiers.append({
                "skill": skill,
                "category": g["group"],
                "tier": ["work", "built", "trained", "listed"][best],
                "evidence_count": len(kinds),
            })
    return rows, tiers


def transform(profile: dict, gh: dict) -> dict[str, list[dict]]:
    handle = profile["person"]["handle"]
    repos_by_name = {r["name"]: r for r in gh["repos"]}

    experience = [
        {
            "id": e["id"],
            "type": e["type"],
            "role": e["role"],
            "company": e["company"],
            "context": clean_text(e.get("context")),
            "mode": e["mode"],
            "start_month": month(e["start"]),
            "end_month": month(e["end"]),
            "is_current": e["end"] is None,
            "stack": e["stack"],
            "highlights": [clean_text(h) for h in e["highlights"]],
        }
        for e in profile["experience"]
    ]

    projects, lineage = [], []
    for p in profile["projects"]:
        repo = repos_by_name.get(p["repo"], {})
        repo_url = repo.get("html_url") or f"https://github.com/{handle}/{p['repo']}"
        metrics = []
        for m in p.get("metrics", []):
            src = m.get("source")
            metric = {
                "label": m["label"],
                "value": str(m["value"]),
                "kind": m.get("kind"),
                "source": src,
                "source_url": f"{repo_url}/blob/HEAD/{src}" if src else None,
                "how": clean_text(m.get("how")),
            }
            metrics.append(metric)
            lineage.append({"project": p["id"], **{k: metric[k] for k in ("label", "value", "kind", "source", "source_url", "how")}})
        projects.append(
            {
                "id": p["id"],
                "name": p["name"],
                "kind": p["kind"],
                "featured": bool(p.get("featured")),
                "summary": clean_text(p["summary"]),
                "problem": clean_text(p.get("problem")),
                "built": clean_text(p.get("built")),
                "result": clean_text(p.get("result")),
                "decisions": [{"title": clean_text(d["title"]), "body": clean_text(d["body"])} for d in p.get("decisions", [])],
                "next": [clean_text(n) for n in p.get("next", [])],
                "media": p.get("media"),
                "stack": p["stack"],
                "repo": p["repo"],
                "repo_url": repo_url,
                "created": (repo.get("created_at") or "")[:10] or None,
                "last_push": (repo.get("pushed_at") or "")[:10] or None,
                "metrics": metrics,
                "topology": p.get("topology", []),
                "edges": p.get("edges", []),
            }
        )

    repos = []
    for r in gh["repos"]:
        langs = r.get("languages") or {}
        total = sum(langs.values()) or 1
        repos.append(
            {
                "name": r["name"],
                "description": clean_text(r.get("description")),
                "language": r.get("language"),
                "stars": r.get("stargazers_count", 0),
                "size_kb": r.get("size", 0),
                "created": r["created_at"][:10],
                "last_push": r["pushed_at"][:10],
                "url": r["html_url"],
                "languages": {k: round(v / total, 3) for k, v in langs.items()},
            }
        )

    evidence, tiers = build_evidence(profile, projects)
    certifications = [{**c, "date": str(c["date"])} for c in profile["certifications"]]
    education = [dict(e) for e in profile["education"]]

    return {
        "person": [profile["person"]],
        "experience": experience,
        "projects": projects,
        "metric_lineage": lineage,
        "skills": tiers,
        "skill_groups": [dict(g) for g in profile["skills"]],
        "skill_evidence": evidence,
        "certifications": certifications,
        "education": education,
        "repos": repos,
    }


# ---------------------------------------------------------------- quality

def walk_strings(obj, path="$"):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_strings(v, f"{path}[{i}]")


def quality(tables: dict[str, list[dict]], tower_rows: list[dict], tower_source: str) -> list[dict]:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str = "", blocking: bool = True) -> None:
        checks.append({"name": name, "passed": bool(ok), "detail": detail, "blocking": blocking})

    dashes = [p for p, s in walk_strings(tables) if EM_DASH in s or SPACED_EN_DASH.search(s)]
    check("text_style", not dashes, ", ".join(dashes[:5]))

    non_ascii = [p for p, s in walk_strings(tables) if re.search(r"[؀-ۿ]", s)]
    check("text_language", not non_ascii, ", ".join(non_ascii[:5]))

    for name in ("experience", "projects"):
        ids = [r["id"] for r in tables[name]]
        check(f"unique_ids_{name}", len(ids) == len(set(ids)))

    bad_ranges = [e["id"] for e in tables["experience"] if e["end_month"] and e["end_month"] < e["start_month"]]
    check("experience_date_order", not bad_ranges, ", ".join(bad_ranges))

    check("experience_type_known", all(e["type"] in ("work", "training") for e in tables["experience"]))
    check("single_current_role", len([e for e in tables["experience"] if e["is_current"]]) <= 1)

    dangling = []
    for p in tables["projects"]:
        node_ids = {n["id"] for n in p["topology"]}
        dangling += [f"{p['id']}:{e}" for e in p["edges"] if e[0] not in node_ids or e[1] not in node_ids]
    check("topology_edges_resolve", not dangling, ", ".join(dangling))

    no_source = [f"{p['id']}:{m['label']}" for p in tables["projects"] if p["featured"] for m in p["metrics"] if not m["source"] or not m["how"]]
    check("metrics_have_lineage", not no_source, ", ".join(no_source))

    public = {r["name"] for r in tables["repos"]}
    if public:  # only when the GitHub snapshot is available
        missing = [p["id"] for p in tables["projects"] if p["repo"] not in public]
        check("project_repos_public", not missing, ", ".join(missing))

    skills = [s["skill"] for s in tables["skills"]]
    check("skills_unique", len(skills) == len(set(skills)) and bool(skills))

    lon0, lat0, lon1, lat1 = tower_layer.BBOX
    outside = sum(1 for t in tower_rows if not (lon0 <= t["lon"] <= lon1 and lat0 <= t["lat"] <= lat1))
    check("towers_in_egypt_bbox", outside == 0 and bool(tower_rows), f"{outside} outside")
    unknown = sum(1 for t in tower_rows if t["operator"] not in tower_layer.OPERATORS)
    check("towers_operator_known", unknown == 0, f"{unknown} unknown")

    if tower_source == "opencellid":
        # OpenCelliD cell ids are only unique within radio, network and area.
        keys = {(t["radio"], t["operator"], t["area"], t["cell"]) for t in tower_rows}
        repeats = len(tower_rows) - len({t["cell"] for t in tower_rows})
        check("towers_natural_key_unique", len(keys) == len(tower_rows),
              f"key (radio, operator, area, cell); {repeats} rows share a cell id with another row")
        claimed = [m["value"] for p in tables["projects"] for m in p["metrics"] if m["label"] == "towers"]
        check("towers_metric_matches_data", all(c.replace(",", "") == str(len(tower_rows)) for c in claimed),
              f"site says {claimed}, data has {len(tower_rows):,}")

        counts: dict[str, int] = {}
        for t in tower_rows:
            counts[t["operator"]] = counts.get(t["operator"], 0) + 1
        ops = tables.get("dbt_operator_performance", [])
        if ops:
            off = [o["operator"] for o in ops if counts.get(o["operator"]) != o["total_towers"]]
            check("dbt_operator_totals_reconcile", not off and len(ops) == len(counts), ", ".join(off))
        risk = tables.get("dbt_regional_risk_index", [])
        if risk:
            areas = {t["area"] for t in tower_rows}
            total = sum(r["total_towers"] for r in risk)
            check("dbt_risk_totals_reconcile", total == len(tower_rows) and len(risk) == len(areas),
                  f"{total} towers in {len(risk)} areas vs {len(tower_rows)} in {len(areas)}")

    # Warnings: visible on the status board, but they do not stop a deploy.
    today = dt.date.today()
    stale = [c["name"] for c in tables["certifications"]
             if c["issuer"] == "Microsoft" and (today - dt.date.fromisoformat(c["date"])).days > 365 and not c.get("url")]
    check("certification_renewal", not stale, ", ".join(stale) + (" is older than a year, add the renewal link" if stale else ""), blocking=False)
    listed = [s["skill"] for s in tables["skills"] if s["tier"] == "listed"]
    check("skills_have_evidence", not listed, ", ".join(listed), blocking=False)
    return checks


# ------------------------------------------------------------------- load

def write_parquet(con, name: str, rows: list[dict]) -> int:
    """Write a table twice: Parquet for downloads and tools, row JSON for the browser console.

    DuckDB-WASM reads row JSON natively. Parquet needs an extension fetched from
    extensions.duckdb.org at runtime, which locked down networks block.
    """
    if not rows:
        return 0
    staged = PARQUET_DIR / f"{name}.json"
    staged.write_text(json.dumps(rows, default=str, separators=(",", ":")))
    out = PARQUET_DIR / f"{name}.parquet"
    con.execute(f"COPY (SELECT * FROM read_json_auto('{staged.as_posix()}')) TO '{out.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    return len(rows)


def load_parquet(tables: dict[str, list[dict]], tower_rows: list[dict], tower_source: str) -> dict[str, int]:
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    p = tables["person"][0]
    sql_tables = {
        "person": [{k: p[k] for k in ("name", "title", "location", "email", "github", "linkedin", "youtube", "x", "status")}],
        "experience": [{k: v for k, v in r.items()} for r in tables["experience"]],
        "projects": [
            {k: r[k] for k in ("id", "name", "kind", "featured", "summary", "stack", "repo_url", "created", "last_push")}
            for r in tables["projects"]
        ],
        "metric_lineage": tables["metric_lineage"],
        "skills": tables["skills"],
        "skill_evidence": tables["skill_evidence"],
        "certifications": [{k: v for k, v in c.items() if k != "url"} for c in tables["certifications"]],
        "education": tables["education"],
        "repos": [{k: v for k, v in r.items() if k != "languages"} for r in tables["repos"]],
        "repo_languages": [
            {"repo": r["name"], "language": lang, "share": share}
            for r in tables["repos"]
            for lang, share in r["languages"].items()
        ],
    }
    if tower_source == "opencellid":  # only real towers are queryable
        sql_tables["towers"] = [
            {"tower_id": t["cell"], "operator": t["operator"], "radio": t["radio"], "lat": t["lat"], "lon": t["lon"], "area": t["area"]}
            for t in tower_rows
        ]
    for name in ("dbt_operator_performance", "dbt_regional_risk_index"):
        if tables.get(name):
            sql_tables[name] = tables[name]
    counts = {name: write_parquet(con, name, rows) for name, rows in sql_tables.items()}
    return {k: v for k, v in counts.items() if v}


def main() -> int:
    offline = "--offline" in sys.argv
    t0 = time.perf_counter()
    run_id = uuid.uuid4().hex[:8]
    started = now_iso()
    log("run", f"run_id={run_id} offline={offline}")

    profile = yaml.safe_load(SOURCE.read_text())
    log("extract", f"profile.yaml: {len(profile['experience'])} roles, {len(profile['projects'])} projects")
    gh = extract_github(profile["person"]["handle"], offline)
    history = extract_run_history(offline)
    tower_rows, tower_source = tower_layer.build(TOWERS_CSV)
    log("extract", f"towers: {len(tower_rows)} ({tower_source})")

    tables = transform(profile, gh)
    tables.update(extract_batch())
    log("transform", ", ".join(f"{k}={len(v)}" for k, v in tables.items()))

    checks = quality(tables, tower_rows, tower_source)
    for c in checks:
        flag = "PASS" if c["passed"] else ("FAIL" if c["blocking"] else "WARN")
        log("quality", f"{flag} {c['name']} {c['detail']}".rstrip())
    if not all(c["passed"] for c in checks if c["blocking"]):
        log("run", "quality gate failed, nothing loaded")
        return 1

    counts = load_parquet(tables, tower_rows, tower_source)
    (PARQUET_DIR / "towers.bin").write_bytes(tower_layer.encode(tower_rows))
    log("load", ", ".join(f"{k}.parquet={v}" for k, v in counts.items()) + f", towers.bin={len(tower_rows)}")

    ops: dict[str, int] = {}
    radios: dict[str, int] = {}
    for t in tower_rows:
        ops[t["operator"]] = ops.get(t["operator"], 0) + 1
        radios[t["radio"]] = radios.get(t["radio"], 0) + 1

    gh_user = gh.get("user") or {}
    run = {
        "run_id": run_id,
        "started_at": started,
        "duration_ms": round((time.perf_counter() - t0) * 1000),
        "github_fetched_at": gh.get("fetched_at"),
        "rows": counts,
        "rows_total": sum(counts.values()),
        "checks": checks,
        "towers": {"source": tower_source, "count": len(tower_rows), "operators": ops, "radios": radios, "bbox": tower_layer.BBOX},
        "github": {
            "followers": gh_user.get("followers"),
            "public_repos": gh_user.get("public_repos"),
            "bio": clean_text(gh_user.get("bio")),
        },
        "trigger": os.environ.get("GITHUB_EVENT_NAME", "local"),
        "commit": (os.environ.get("GITHUB_SHA") or "local")[:7],
    }

    summary = {
        "run_id": run_id,
        "started_at": started,
        "duration_ms": run["duration_ms"],
        "rows_total": run["rows_total"],
        "checks_passed": sum(c["passed"] for c in checks if c["blocking"]),
        "checks_total": sum(1 for c in checks if c["blocking"]),
        "warnings": sum(1 for c in checks if not c["blocking"] and not c["passed"]),
        "trigger": run["trigger"],
        "commit": run["commit"],
    }
    history = [h for h in history if h.get("run_id") != run_id][-(HISTORY_KEEP - 1):] + [summary]
    run["history"] = history
    RUNS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    RUNS_CACHE.write_text(json.dumps(history))
    con = duckdb.connect()
    run["rows"]["runs"] = write_parquet(con, "runs", history)
    run["rows"]["quality_checks"] = write_parquet(con, "quality_checks", [{"run_id": run_id, **c} for c in checks])

    JSON_DIR.mkdir(parents=True, exist_ok=True)
    (JSON_DIR / "warehouse.json").write_text(json.dumps(tables, indent=1, default=str))
    (JSON_DIR / "run.json").write_text(json.dumps(run, indent=1))
    log("run", f"done in {run['duration_ms']} ms, {run['rows_total']} rows, {len(history)} runs in history")
    return 0


if __name__ == "__main__":
    sys.exit(main())
