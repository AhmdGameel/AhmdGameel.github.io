"""Portfolio pipeline.

extract   profile.yaml + GitHub REST API
transform normalize into tables, clean free text
quality   contract checks, the run fails if any check fails
load      Parquet for the in browser SQL console, JSON for the static site

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

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "pipeline" / "sources" / "profile.yaml"
CACHE = ROOT / "pipeline" / "cache" / "github.json"
PARQUET_DIR = ROOT / "public" / "data"
JSON_DIR = ROOT / "src" / "data"

EM_DASH = "\u2014"
SPACED_EN_DASH = re.compile(r"\s\u2013\s")


def log(stage: str, msg: str) -> None:
    print(f"[{stage:>9}] {msg}", flush=True)


# ---------------------------------------------------------------- extract

def gh_get(path: str) -> object:
    req = urllib.request.Request(f"https://api.github.com{path}")
    req.add_header("Accept", "application/vnd.github+json")
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def extract_github(handle: str, offline: bool) -> dict:
    if not offline:
        try:
            user = gh_get(f"/users/{handle}")
            repos = gh_get(f"/users/{handle}/repos?per_page=100&sort=updated")
            repos = [r for r in repos if not r["fork"] and r["name"] not in (handle, "test", f"{handle}.github.io")]
            for r in repos:
                r["languages"] = gh_get(f"/repos/{handle}/{r['name']}/languages")
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


def transform(profile: dict, gh: dict) -> dict[str, list[dict]]:
    repos_by_name = {r["name"]: r for r in gh["repos"]}

    experience = [
        {
            "id": e["id"],
            "role": e["role"],
            "company": e["company"],
            "mode": e["mode"],
            "start_month": month(e["start"]),
            "end_month": month(e["end"]),
            "is_current": e["end"] is None,
            "stack": e["stack"],
            "highlights": e["highlights"],
        }
        for e in profile["experience"]
    ]

    projects = []
    for p in profile["projects"]:
        repo = repos_by_name.get(p["repo"], {})
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
                "stack": p["stack"],
                "repo_url": repo.get("html_url") or f"https://github.com/{profile['person']['handle']}/{p['repo']}",
                "stars": repo.get("stargazers_count", 0),
                "last_push": (repo.get("pushed_at") or "")[:10] or None,
                "metrics": p.get("metrics", []),
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

    skills = [dict(s) for s in profile["skills"]]
    certifications = [{**c, "date": str(c["date"])} for c in profile["certifications"]]
    education = [dict(e) for e in profile["education"]]

    return {
        "person": [profile["person"]],
        "experience": experience,
        "projects": projects,
        "skills": skills,
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


def quality(tables: dict[str, list[dict]]) -> list[dict]:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "passed": ok, "detail": detail})

    dashes = [p for p, s in walk_strings(tables) if EM_DASH in s or SPACED_EN_DASH.search(s)]
    check("no_em_dashes", not dashes, ", ".join(dashes[:5]))

    non_ascii = [p for p, s in walk_strings(tables) if re.search(r"[؀-ۿ]", s)]
    check("english_only", not non_ascii, ", ".join(non_ascii[:5]))

    for name in ("experience", "projects"):
        ids = [r["id"] for r in tables[name]]
        check(f"unique_ids_{name}", len(ids) == len(set(ids)))

    bad_ranges = [
        e["id"] for e in tables["experience"] if e["end_month"] and e["end_month"] < e["start_month"]
    ]
    check("experience_date_order", not bad_ranges, ", ".join(bad_ranges))

    current = [e for e in tables["experience"] if e["is_current"]]
    check("single_current_role", len(current) <= 1)

    for p in tables["projects"]:
        node_ids = {n["id"] for n in p["topology"]}
        dangling = [e for e in p["edges"] if e[0] not in node_ids or e[1] not in node_ids]
        if dangling:
            check(f"topology_edges_{p['id']}", False, str(dangling))
    check("topology_edges_resolve", all(c["passed"] for c in checks if c["name"].startswith("topology_edges_")))

    check("skills_level_range", all(1 <= s["level"] <= 5 for s in tables["skills"]))
    return checks


# ------------------------------------------------------------------- load

def load_parquet(tables: dict[str, list[dict]]) -> dict[str, int]:
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    counts = {}
    sql_tables = {
        "person": [
            {k: v for k, v in tables["person"][0].items() if k in ("name", "title", "location", "email", "github", "linkedin", "status", "tagline")}
        ],
        "experience": [
            {k: v for k, v in r.items()} for r in tables["experience"]
        ],
        "projects": [
            {k: r[k] for k in ("id", "name", "kind", "featured", "summary", "stack", "repo_url", "stars", "last_push")}
            for r in tables["projects"]
        ],
        "skills": tables["skills"],
        "certifications": tables["certifications"],
        "education": tables["education"],
        "repos": [{k: v for k, v in r.items() if k != "languages"} for r in tables["repos"]],
        "repo_languages": [
            {"repo": r["name"], "language": lang, "share": share}
            for r in tables["repos"]
            for lang, share in r["languages"].items()
        ],
    }
    tmp = PARQUET_DIR / "_staging.json"
    for name, rows in sql_tables.items():
        if not rows:
            continue
        tmp.write_text(json.dumps(rows))
        out = PARQUET_DIR / f"{name}.parquet"
        con.execute(
            f"COPY (SELECT * FROM read_json_auto('{tmp.as_posix()}')) TO '{out.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        counts[name] = len(rows)
    tmp.unlink(missing_ok=True)
    return counts


def main() -> int:
    offline = "--offline" in sys.argv
    t0 = time.perf_counter()
    run_id = uuid.uuid4().hex[:8]
    started = now_iso()
    log("run", f"run_id={run_id} offline={offline}")

    profile = yaml.safe_load(SOURCE.read_text())
    log("extract", f"profile.yaml: {len(profile['experience'])} roles, {len(profile['projects'])} projects")
    gh = extract_github(profile["person"]["handle"], offline)

    tables = transform(profile, gh)
    log("transform", ", ".join(f"{k}={len(v)}" for k, v in tables.items()))

    checks = quality(tables)
    for c in checks:
        log("quality", f"{'PASS' if c['passed'] else 'FAIL'} {c['name']} {c['detail']}".rstrip())
    if not all(c["passed"] for c in checks):
        log("run", "quality gate failed, nothing loaded")
        return 1

    counts = load_parquet(tables)
    log("load", ", ".join(f"{k}.parquet={v}" for k, v in counts.items()))

    gh_user = gh.get("user") or {}
    run = {
        "run_id": run_id,
        "started_at": started,
        "duration_ms": round((time.perf_counter() - t0) * 1000),
        "github_fetched_at": gh.get("fetched_at"),
        "rows": counts,
        "rows_total": sum(counts.values()),
        "checks": checks,
        "github": {
            "followers": gh_user.get("followers"),
            "public_repos": gh_user.get("public_repos"),
            "bio": clean_text(gh_user.get("bio")),
        },
        "trigger": os.environ.get("GITHUB_EVENT_NAME", "local"),
        "commit": (os.environ.get("GITHUB_SHA") or "local")[:7],
    }
    JSON_DIR.mkdir(parents=True, exist_ok=True)
    (JSON_DIR / "warehouse.json").write_text(json.dumps(tables, indent=1, default=str))
    (JSON_DIR / "run.json").write_text(json.dumps(run, indent=1))
    log("run", f"done in {run['duration_ms']} ms, {run['rows_total']} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
