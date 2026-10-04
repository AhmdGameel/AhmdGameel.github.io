"""Cell tower layer for the hero map.

Real mode    pipeline/sources/towers_clean.csv exists (the output of data_cleaner.py in the
             tower-health-stream repo, OpenCelliD MCC 602). Every point is a real tower.
Illustrative no CSV yet. Points are generated from a seeded model of where Egyptians live
             (the Nile valley, the Delta, the canal and the coasts) with the real operator
             split, and the site labels them as illustrative.

Both modes write the same binary layout, so the front end does not care which one ran:

  header  'TWR1' | uint32 count | float32 lon_min, lat_min, lon_max, lat_max      (24 bytes)
  row     uint16 x | uint16 y | uint8 operator | uint8 radio | uint16 area | uint32 cell
          x and y are quantized to the bounding box, 0..65535                     (12 bytes)
"""

from __future__ import annotations

import csv
import math
import random
import struct
from pathlib import Path

OPERATORS = ["Orange", "Vodafone", "e&", "WE"]  # index = OpenCelliD net - 1
RADIOS = ["GSM", "UMTS", "LTE", "NR", "CDMA"]
# Operator split of the cleaned dataset, from the tower-health-stream README.
OPERATOR_COUNTS = {"Vodafone": 4791, "e&": 2774, "Orange": 2212, "WE": 415}
BBOX = (24.6, 21.7, 37.0, 31.8)  # lon_min, lat_min, lon_max, lat_max


def load_real(path: Path) -> list[dict]:
    rows = []
    with path.open(newline="") as f:
        for r in csv.DictReader(f):
            rows.append(
                {
                    "cell": int(float(r["tower_id"])),
                    "operator": r["operator"],
                    "radio": r["radio"].upper(),
                    "lat": float(r["lat"]),
                    "lon": float(r["lon"]),
                    "area": int(float(r["area"])),
                }
            )
    return rows


# --------------------------------------------------------------- illustrative

# (lat, lon, weight, spread in degrees)
CLUSTERS = [
    (30.044, 31.236, 1500, 0.10), (30.03, 31.47, 260, 0.06), (29.95, 30.93, 260, 0.07),
    (29.85, 31.33, 120, 0.04), (30.13, 31.24, 160, 0.04), (30.29, 31.74, 110, 0.05),
    (30.02, 31.70, 50, 0.04), (30.06, 31.21, 400, 0.04),
    (31.20, 29.92, 380, 0.05), (30.92, 29.55, 50, 0.04),
    (30.79, 31.00, 200, 0.04), (31.04, 31.38, 200, 0.04), (30.59, 31.50, 150, 0.04),
    (31.03, 30.47, 110, 0.04), (31.11, 30.94, 110, 0.04), (30.46, 31.18, 100, 0.03),
    (30.55, 31.01, 90, 0.03), (30.97, 31.17, 120, 0.03), (31.42, 31.81, 100, 0.03),
    (31.26, 32.30, 140, 0.03), (30.60, 32.27, 110, 0.03), (29.97, 32.53, 120, 0.03),
    (31.13, 30.65, 45, 0.03), (30.72, 31.26, 45, 0.03), (30.42, 31.56, 45, 0.03),
    (31.13, 30.13, 55, 0.03),
    (29.31, 30.84, 170, 0.09), (29.07, 31.10, 90, 0.04), (28.10, 30.75, 120, 0.04),
    (27.18, 31.18, 140, 0.04), (26.56, 31.69, 120, 0.04), (26.16, 32.72, 80, 0.04),
    (25.69, 32.64, 100, 0.04), (24.09, 32.90, 90, 0.04),
    (31.35, 27.24, 60, 0.04), (31.13, 33.80, 60, 0.04), (27.91, 34.33, 100, 0.04),
    (28.50, 34.51, 25, 0.02), (27.26, 33.81, 160, 0.05), (27.39, 33.68, 25, 0.02),
    (29.60, 32.35, 40, 0.03), (29.20, 25.52, 22, 0.03), (25.44, 30.55, 35, 0.04),
    (25.50, 29.00, 25, 0.04), (28.35, 28.86, 18, 0.03), (27.06, 27.97, 10, 0.02),
    (22.34, 31.62, 14, 0.02), (26.74, 33.94, 30, 0.02), (25.07, 34.89, 25, 0.02),
]

# (points along the line, lateral spread, [(lat, lon), ...])
LINES = [
    (1500, 0.055, [(29.85, 31.28), (29.50, 31.20), (29.07, 31.10), (28.50, 30.85), (28.10, 30.75),
                   (27.70, 30.85), (27.18, 31.18), (26.90, 31.40), (26.56, 31.69), (26.33, 31.89),
                   (26.05, 32.25), (26.16, 32.72), (25.70, 32.64), (25.29, 32.55), (24.97, 32.87),
                   (24.47, 32.93), (24.09, 32.90)]),
    (140, 0.02, [(31.26, 32.30), (30.95, 32.32), (30.60, 32.27), (30.30, 32.37), (29.97, 32.53)]),
    (230, 0.03, [(31.15, 29.75), (30.95, 29.30), (30.83, 28.95), (31.00, 28.40), (31.35, 27.24),
                 (31.45, 26.30), (31.55, 25.16)]),
    (210, 0.022, [(29.60, 32.35), (29.11, 32.66), (28.36, 33.08), (27.26, 33.81), (26.74, 33.94),
                  (26.10, 34.28), (25.07, 34.89), (23.95, 35.47)]),
    (60, 0.02, [(31.26, 32.30), (31.05, 32.60), (31.13, 33.80), (31.28, 34.24)]),
    (60, 0.02, [(29.97, 32.53), (29.60, 32.70), (29.10, 32.95), (28.24, 33.62), (27.91, 34.33),
                (28.50, 34.51), (29.03, 34.66), (29.49, 34.89)]),
    (60, 0.012, [(30.10, 31.00), (30.40, 30.60), (30.80, 30.10)]),
    (25, 0.01, [(30.06, 31.40), (30.02, 31.95), (29.97, 32.53)]),
    (22, 0.01, [(26.16, 32.72), (26.45, 33.30), (26.74, 33.94)]),
    (22, 0.012, [(27.18, 31.18), (26.30, 30.80), (25.44, 30.55), (25.50, 29.00)]),
    (12, 0.01, [(24.09, 32.90), (23.30, 32.20), (22.34, 31.62)]),
    (14, 0.012, [(29.31, 30.84), (28.80, 29.70), (28.35, 28.86), (27.06, 27.97)]),
]

DELTA = [(30.15, 31.20), (30.55, 30.55), (31.05, 30.05), (31.35, 30.35), (31.55, 31.10),
         (31.45, 31.85), (31.20, 32.25), (30.80, 32.05), (30.40, 31.75)]
DELTA_WEIGHT = 1300


def _in_poly(lat: float, lon: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def generate_illustrative(total: int = 10192, seed: int = 602) -> list[dict]:
    rng = random.Random(seed)
    weights = [c[2] for c in CLUSTERS] + [l[0] for l in LINES] + [DELTA_WEIGHT]
    scale = total / sum(weights)
    raw = [w * scale for w in weights]
    counts = [int(x) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - counts[i], reverse=True)[: total - sum(counts)]:
        counts[i] += 1

    points: list[tuple[float, float, int]] = []
    area = 0
    for (lat, lon, _, s), n in zip(CLUSTERS, counts):
        area += 1
        for _ in range(n):
            # a dense core with a long tail, like a city and its suburbs
            r = s * (rng.random() ** 1.6) * 2.2
            a = rng.random() * math.tau
            points.append((lat + r * math.sin(a), lon + r * math.cos(a) / math.cos(math.radians(lat)), area))

    offset = len(CLUSTERS)
    for (_, s, path), n in zip(LINES, counts[offset:offset + len(LINES)]):
        seg = [math.dist(path[i], path[i + 1]) for i in range(len(path) - 1)]
        total_len = sum(seg)
        for _ in range(n):
            d = rng.random() * total_len
            i = 0
            while d > seg[i] and i < len(seg) - 1:
                d -= seg[i]
                i += 1
            t = d / seg[i]
            (la, lo), (lb, lob) = path[i], path[i + 1]
            lat, lon = la + (lb - la) * t, lo + (lob - lo) * t
            area = 100 + len(points) // 40
            points.append((lat + rng.gauss(0, s), lon + rng.gauss(0, s), area))

    n = counts[-1]
    lats = [p[0] for p in DELTA]
    lons = [p[1] for p in DELTA]
    while n:
        lat, lon = rng.uniform(min(lats), max(lats)), rng.uniform(min(lons), max(lons))
        if _in_poly(lat, lon, DELTA):
            points.append((lat, lon, 400 + int((lat - 30) * 8) * 20 + int((lon - 30) * 8)))
            n -= 1

    operators = [op for op, c in OPERATOR_COUNTS.items() for _ in range(c)]
    rng.shuffle(operators)
    rng.shuffle(points)
    radios = rng.choices(["LTE", "UMTS", "GSM"], weights=[50, 30, 20], k=total)
    return [
        {"cell": 100000 + i, "operator": operators[i], "radio": radios[i], "lat": lat, "lon": lon, "area": a}
        for i, (lat, lon, a) in enumerate(points)
    ]


# ---------------------------------------------------------------- encoding

def encode(rows: list[dict]) -> bytes:
    lon0, lat0, lon1, lat1 = BBOX
    out = bytearray(b"TWR1")
    out += struct.pack("<I4f", len(rows), lon0, lat0, lon1, lat1)
    for r in rows:
        x = round((r["lon"] - lon0) / (lon1 - lon0) * 65535)
        y = round((r["lat"] - lat0) / (lat1 - lat0) * 65535)
        op = OPERATORS.index(r["operator"]) if r["operator"] in OPERATORS else 255
        radio = RADIOS.index(r["radio"]) if r["radio"] in RADIOS else 255
        out += struct.pack("<HHBBHI", min(max(x, 0), 65535), min(max(y, 0), 65535), op, radio, r["area"] & 0xFFFF, r["cell"] & 0xFFFFFFFF)
    return bytes(out)


def build(source_csv: Path) -> tuple[list[dict], str]:
    if source_csv.exists():
        return load_real(source_csv), "opencellid"
    return generate_illustrative(), "illustrative"
