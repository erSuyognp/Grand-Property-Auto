"""Check the game data for a city: print counts, fail if a listing has no building or no lat/lon.

    python tools/check_data.py houston la mock
"""
import json
import sys

from common import PUBLIC_DATA


def check(city):
    d = PUBLIC_DATA / city
    problems = []
    need = ["area.json", "ground.jpg", "ground.json", "buildings.geojson", "listings.json", "terrain.json", "scatter.json", "nearby.json"]
    for name in need:
        if not (d / name).exists():
            problems.append(f"missing {name}")
    if problems:
        return problems
    buildings = json.loads((d / "buildings.geojson").read_text())["features"]
    ids = {b["properties"]["id"] for b in buildings}
    listings = json.loads((d / "listings.json").read_text())
    kinds = {}
    for l in listings:
        kinds[l["kind"]] = kinds.get(l["kind"], 0) + 1
        if l.get("lat") is None or l.get("lon") is None:
            problems.append(f"listing {l['id']} has no lat/lon")
        if l.get("buildingId") not in ids:
            problems.append(f"listing {l['id']} has no building")
    area = json.loads((d / "area.json").read_text())
    w, s, e, n = area["bbox"]
    outside = sum(1 for l in listings if not (w <= l["lon"] <= e and s <= l["lat"] <= n))
    mp = [p for p in (d / "mp").glob("*.json")] if (d / "mp").exists() else []
    with_mp = sum(1 for l in listings if l.get("matterportIds"))
    with_local = sum(1 for l in listings if any((d / "mp" / f"{m}.json").exists() for m in l.get("matterportIds", [])))
    scatter = json.loads((d / "scatter.json").read_text())
    nearby = json.loads((d / "nearby.json").read_text())
    size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
    first = sum((d / n).stat().st_size for n in ["ground.jpg", "buildings.geojson", "listings.json", "terrain.json", "scatter.json", "nearby.json"])
    heights = {}
    for b in buildings:
        heights[b["properties"].get("src", "?")] = heights.get(b["properties"].get("src", "?"), 0) + 1
    print(f"{city}: {len(buildings)} buildings (height sources {heights}), {len(listings)} listings {kinds}")
    print(f"  tours: {with_mp} listings have a 3D model, {with_local} have panoramas on disk ({len(mp)} models); curb photos on {sum(1 for l in listings if l.get('curbPhotos'))}")
    print(f"  pools seen from the air on {sum(1 for l in listings if l.get('vexcel', {}).get('poolDetected'))} listings; {len(scatter['trees'])} trees, {len(scatter['pools'])} pools; nearby words {[k for k, v in nearby.items() if v]}")
    print(f"  {outside} listings outside the bbox; first load {first / 1e6:.1f} MB, everything {size / 1e6:.0f} MB")
    if outside:
        problems.append(f"{outside} listings outside the bbox")
    return problems


if __name__ == "__main__":
    bad = False
    for city in sys.argv[1:] or ["houston", "la", "mock"]:
        problems = check(city)
        for p in problems[:20]:
            print(f"  PROBLEM {city}: {p}")
        bad = bad or bool(problems)
    sys.exit(1 if bad else 0)
