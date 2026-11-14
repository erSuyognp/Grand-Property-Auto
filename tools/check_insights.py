"""Check the insight files: coverage per source per city, outliers, listings missing insights.

    python tools/check_insights.py            (la, houston and mock)
    python tools/check_insights.py houston

Exit code 1 when something needs fixing: a listing without an insight file, a broken number
(negative, not finite), a monthly cost over $50,000, or a drive time over 2 hours.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PUBLIC_DATA  # noqa: E402

SECTIONS = [
    ("value", "CoStar comps (value vs nearby)", lambda d: d.get("value")),
    ("rentVsBuy", "CoStar apartment rents nearby", lambda d: d.get("rentVsBuy")),
    ("home", "CoStar listing features", lambda d: any((d.get("home") or {}).get(k) for k in ("highlights", "parking", "utilities", "schools", "community", "hoa"))),
    ("activity", "CoStar commercial activity", lambda d: (d.get("activity") or {}).get("facts")),
    ("aerial", "Vexcel roof / pool / trees", lambda d: (d.get("aerial") or {}).get("roofMaterial")),
    ("places", "OpenStreetMap places", lambda d: (d.get("places") or {}).get("supermarket")),
    ("noise", "OpenStreetMap highway / rail / airport", lambda d: any((d.get("noise") or {}).values())),
    ("census", "Census ACS tract values", lambda d: (d.get("census") or {}).get("income")),
    ("nri", "FEMA National Risk Index", lambda d: ((d.get("risk") or {}).get("nri") or {}).get("rating")),
    ("flood", "FEMA flood zone", lambda d: (d.get("risk") or {}).get("flood")),
    ("energy", "EIA electric bill estimate", lambda d: d.get("energy")),
    ("solar", "NREL PVWatts solar estimate", lambda d: (d.get("solar") or {}).get("panels")),
    ("cost", "FRED rate / monthly cost", lambda d: d.get("cost")),
    ("scores", "Scores", lambda d: d.get("scores")),
]


def walk(v, path=""):
    """Every number in the file with its path."""
    if isinstance(v, dict):
        for k, x in v.items():
            yield from walk(x, f"{path}.{k}" if path else k)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from walk(x, f"{path}[{i}]")
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        yield path, v


def check(city):
    d = PUBLIC_DATA / city
    if not (d / "listings.json").exists():
        print(f"{city}: no data")
        return 0
    listings = json.loads((d / "listings.json").read_text(encoding="utf-8"))
    problems, cov = [], {k: 0 for k, _, _ in SECTIONS}
    homes = 0
    index = {r["id"]: r for r in json.loads((d / "insights" / "index.json").read_text(encoding="utf-8"))} if (d / "insights" / "index.json").exists() else {}
    for l in listings:
        p = d / "insights" / f"{l['id']}.json"
        if not p.exists():
            problems.append(f"{l['id']}: no insight file")
            continue
        ins = json.loads(p.read_text(encoding="utf-8"))
        if str(l["id"]) not in index:
            problems.append(f"{l['id']}: missing from insights/index.json")
        is_home = l["kind"] in ("sale", "sold") and l.get("price")
        homes += 1 if is_home else 0
        for key, _, fn in SECTIONS:
            if fn(ins):
                cov[key] += 1
        for path, v in walk(ins):
            if isinstance(v, float) and not math.isfinite(v):
                problems.append(f"{l['id']}: {path} is not a finite number")
            elif v < 0 and not path.endswith(".solar") and "lon" not in path and "lat" not in path:
                problems.append(f"{l['id']}: {path} is negative ({v})")
        c = ins.get("cost")
        if c and c["total"] > 50000:
            problems.append(f"{l['id']}: monthly cost ${c['total']:,} is over $50,000")
        if c and c["total"] <= 0:
            problems.append(f"{l['id']}: monthly cost is {c['total']}")
        for cat, items in (ins.get("places") or {}).items():
            for it in items:
                if it.get("driveMin", 0) > 120:
                    problems.append(f"{l['id']}: {cat} drive time {it['driveMin']} min is over 2 hours")
        dt = ((ins.get("drive") or {}).get("downtown") or {}).get("min")
        if dt and dt > 120:
            problems.append(f"{l['id']}: downtown drive {dt} min is over 2 hours")
        for name, s in (ins.get("scores") or {}).items():
            if not 0 <= s["score"] <= 100:
                problems.append(f"{l['id']}: score {name} = {s['score']}")
        e = ins.get("energy")
        if e and not 20 <= e["billMonth"] <= 1500:
            problems.append(f"{l['id']}: electric bill ${e['billMonth']} a month looks wrong")
    n = len(listings)
    print(f"\n{city}: {n} listings ({homes} homes with a price)")
    print(f"  {'source':42} {'have':>5} {'of':>4}")
    for key, label, _ in SECTIONS:
        of = homes if key in ("value", "cost") else n
        print(f"  {label:42} {cov[key]:>5} {of:>4}")
    for p in problems[:40]:
        print("  PROBLEM", p)
    if not problems:
        print("  no outliers, nothing missing")
    return len(problems)


if __name__ == "__main__":
    cities = sys.argv[1:] or ["la", "houston", "mock"]
    bad = sum(check(c) for c in cities)
    sys.exit(1 if bad else 0)
