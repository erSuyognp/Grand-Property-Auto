"""Insight pipeline: precomputes everything the property panel, Maya and the client missions need.

    python tools/enrich_city.py --city la|houston|mock

Writes public/data/<city>/insights/<id>.json (one per listing), insights/index.json (a small
summary of every listing) and adds an "insights" block (sources, city comparison values) to
public/data/<city>/area.json. Every external response is cached under data/cache/<source>/.
One request at a time per source, back off on 429, never fail the run on one listing.

What leaves the laptop: coordinates only (a bounding box to OpenStreetMap; points to the Census
geocoder, FEMA and NREL). No address, price, listing id, agent or tenant data.
`--city mock` makes synthetic values offline (no external calls, no Sponsor Data).
"""
import argparse
import datetime as dt
import io
import json
import math
import os
import random
import re
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, DiskCache, PUBLIC_DATA, cache_key, load_env  # noqa: E402

TODAY = dt.date.today().isoformat()
UA = {"User-Agent": "gpa-insights/0.1 (local hackathon build)"}
DOWNTOWN = {"la": (34.0537, -118.2428, "Downtown LA"), "houston": (29.7604, -95.3698, "Downtown Houston"), "mock": (35.03, -99.97, "Downtown")}
GEO = {"la": {"place": "16000US0644000", "county": "05000US06037", "state": "California", "st": "CA", "countyName": "Los Angeles County"},
       "houston": {"place": "16000US4835000", "county": "05000US48201", "state": "Texas", "st": "TX", "countyName": "Harris County"}}
HAZARDS = {"AVLN": "Avalanche", "CFLD": "Coastal flooding", "CWAV": "Cold wave", "DRGT": "Drought", "ERQK": "Earthquake", "HAIL": "Hail",
           "HWAV": "Heat wave", "HRCN": "Hurricane", "ISTM": "Ice storm", "LNDS": "Landslide", "LTNG": "Lightning", "IFLD": "Inland flooding",
           "SWND": "Strong wind", "TRND": "Tornado", "TSUN": "Tsunami", "VLCN": "Volcanic activity", "WFIR": "Wildfire", "WNTW": "Winter weather"}
RATING_RANK = {"Very High": 5, "Relatively High": 4, "Relatively Moderate": 3, "Relatively Low": 2, "Very Low": 1}
WALK_M_PER_MIN, DRIVE_M_PER_MIN, DETOUR = 80.0, 25 * 1609.34 / 60, 1.3
PANEL_W, PANEL_M2 = 400, 1.95
coverage = {}


def log(msg):
    print(f"[enrich] {msg}", flush=True)


def note(source, ok):
    c = coverage.setdefault(source, [0, 0])
    c[0] += 1 if ok else 0
    c[1] += 1


def hav(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def drive_min(d):
    return max(1, round(d * DETOUR / DRIVE_M_PER_MIN))


def walk_min(d):
    return max(1, round(d * DETOUR / WALK_M_PER_MIN))


def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def med(xs):
    xs = [x for x in xs if x]
    return statistics.median(xs) if xs else None


# ------------------------------------------------------------------ cached HTTP, one request at a time
_last = {}


def fetch(source, url, params=None, data=None, timeout=60, kind="json", tries=3, gap=0.4, headers=None):
    import requests
    cache = DiskCache(source)
    key = cache_key(url, params, data)
    got = cache.get_json(key)
    if got is not None:
        return got.get("v")
    for attempt in range(tries):
        wait = gap - (time.time() - _last.get(source, 0))
        if wait > 0:
            time.sleep(wait)
        try:
            h = {**UA, **(headers or {})}
            r = requests.post(url, data=data, headers=h, timeout=timeout) if data is not None else requests.get(url, params=params, headers=h, timeout=timeout)
            _last[source] = time.time()
            if r.status_code in (429, 502, 503, 504):
                time.sleep(4 * (attempt + 1) ** 2)
                continue
            if not r.ok:
                log(f"  {source}: HTTP {r.status_code}")
                return None
            v = r.json() if kind == "json" else r.text if kind == "text" else list(r.content)
            cache.put_json(key, {"v": v})
            return v
        except Exception as e:  # noqa: BLE001
            log(f"  {source}: {type(e).__name__} {str(e)[:90]}")
            time.sleep(2 * (attempt + 1))
    return None


# ------------------------------------------------------------------ OpenStreetMap
def poi_category(tags):
    out = []
    shop, amen, leis = tags.get("shop"), tags.get("amenity"), tags.get("leisure")
    if shop == "supermarket":
        out.append("supermarket")
    if amen == "school":
        out.append("school")
    if leis == "park":
        out.append("park")
    if tags.get("highway") == "bus_stop" or tags.get("railway") in ("station", "tram_stop", "halt") or tags.get("public_transport") == "station":
        out.append("transit")
    if leis == "fitness_centre":
        out.append("gym")
    if amen in ("pharmacy", "hospital", "cafe"):
        out.append(amen)
    if amen in ("restaurant", "fast_food"):
        out.append("restaurant")
    if shop or amen in ("restaurant", "fast_food", "cafe", "bar"):
        out.append("shopfront")
    return out


GENERIC = {"supermarket": "Supermarket", "school": "School", "park": "Park", "transit": "Transit stop", "gym": "Gym", "pharmacy": "Pharmacy",
           "hospital": "Hospital", "cafe": "Cafe", "restaurant": "Restaurant"}


def osm_places(area):
    w, s, e, n = area["bbox"]
    mlat, mlon = 3000 / 111320, 3000 / (111320 * math.cos(math.radians((s + n) / 2)))
    bb = f"{s - mlat:.5f},{w - mlon:.5f},{n + mlat:.5f},{e + mlon:.5f}"
    q1 = f"""[out:json][timeout:170];(
nwr["shop"]({bb});nwr["amenity"~"^(school|pharmacy|hospital|cafe|restaurant|fast_food|bar)$"]({bb});
nwr["leisure"~"^(park|fitness_centre)$"]({bb});node["highway"="bus_stop"]({bb});
nwr["railway"~"^(station|tram_stop|halt)$"]({bb});nwr["public_transport"="station"]({bb}););out center tags;"""
    q2 = f"""[out:json][timeout:170];(way["highway"~"^(motorway|trunk)$"]({bb});way["railway"~"^(rail|light_rail)$"]["tunnel"!="yes"]({bb}););out geom;"""
    lat0, lon0 = area["center"]
    q3 = f"""[out:json][timeout:120];nwr["aeroway"="aerodrome"]["iata"](around:45000,{lat0},{lon0});out center tags;"""
    res = []
    for q in (q1, q2, q3):
        v = None
        for host in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
            v = fetch("osm", host, data={"data": q}, timeout=200, tries=2, gap=2)
            if v:
                break
        res.append(v or {"elements": []})
    pois = {k: [] for k in list(GENERIC) + ["shopfront"]}
    seen = set()
    for el in res[0]["elements"]:
        tags = el.get("tags") or {}
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None:
            continue
        for cat in poi_category(tags):
            name = tags.get("name") or GENERIC.get(cat, "")
            k = (cat, name, round(lat, 4), round(lon, 4))
            if k in seen:
                continue
            seen.add(k)
            pois[cat].append({"name": name, "lat": lat, "lon": lon})
    lines = {"highway": [], "rail": []}
    for el in res[1]["elements"]:
        tags = el.get("tags") or {}
        g = [(p["lat"], p["lon"]) for p in el.get("geometry") or []]
        if len(g) < 2:
            continue
        if tags.get("highway"):
            lines["highway"].append({"name": tags.get("ref") or tags.get("name") or "Highway", "pts": g})
        else:
            lines["rail"].append({"name": tags.get("name") or "Rail line", "pts": g})
    airports = []
    for el in res[2]["elements"]:
        tags = el.get("tags") or {}
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is not None:
            airports.append({"name": tags.get("name") or tags.get("iata"), "lat": lat, "lon": lon})
    ok = sum(len(v) for v in pois.values()) > 0
    log(f"  OpenStreetMap: " + ", ".join(f"{k} {len(v)}" for k, v in pois.items()) + f", highways {len(lines['highway'])}, rail {len(lines['rail'])}, airports {len(airports)}")
    return pois, lines, airports, ok


def dist_to_lines(lat, lon, lines):
    best, name = None, None
    kx = 111320 * math.cos(math.radians(lat))
    for ln in lines:
        pts = ln["pts"]
        for i in range(len(pts) - 1):
            ax, ay = (pts[i][1] - lon) * kx, (pts[i][0] - lat) * 111320
            bx, by = (pts[i + 1][1] - lon) * kx, (pts[i + 1][0] - lat) * 111320
            ex, ey = bx - ax, by - ay
            t = clamp(-(ax * ex + ay * ey) / (ex * ex + ey * ey or 1), 0, 1)
            d = math.hypot(ax + ex * t, ay + ey * t)
            if best is None or d < best:
                best, name = d, ln["name"]
    return (round(best), name) if best is not None else (None, None)


def nearest(lat, lon, items, k=3):
    out = sorted(({**p, "distM": round(hav(lat, lon, p["lat"], p["lon"]))} for p in items), key=lambda p: p["distM"])[:k]
    for p in out:
        p["walkMin"], p["driveMin"], p["est"] = walk_min(p["distM"]), drive_min(p["distM"]), True
        p["lat"], p["lon"] = round(p["lat"], 6), round(p["lon"], 6)
    return out


# ------------------------------------------------------------------ Census, FEMA, EIA, FRED, NREL
def census_tract(lat, lon):
    v = fetch("census_geocoder", "https://geocoding.geo.census.gov/geocoder/geographies/coordinates",
              params={"x": round(lon, 5), "y": round(lat, 5), "benchmark": "Public_AR_Current", "vintage": "Current_Current", "layers": "Census Tracts", "format": "json"})
    try:
        return v["result"]["geographies"]["Census Tracts"][0]["GEOID"]
    except Exception:  # noqa: BLE001
        return None


def acs(geo_ids):
    v = fetch("acs", "https://api.censusreporter.org/1.0/data/show/latest",
              params={"table_ids": "B19013,B25077,B25064,B25003,B25035,B25103", "geo_ids": ",".join(sorted(geo_ids))})
    if not v or "data" not in v:
        return {}, None
    rel = (v.get("release") or {})
    out = {}
    for gid, t in v["data"].items():
        g = lambda tb, col: (((t.get(tb) or {}).get("estimate") or {}).get(col))  # noqa: E731
        pos = lambda x: x if isinstance(x, (int, float)) and x > 0 else None  # noqa: E731
        occ, own = pos(g("B25003", "B25003001")), g("B25003", "B25003002")
        out[gid] = {"income": pos(g("B19013", "B19013001")), "homeValue": pos(g("B25077", "B25077001")), "grossRent": pos(g("B25064", "B25064001")),
                    "ownerShare": round(100 * own / occ) if occ and own is not None else None, "medianYearBuilt": pos(g("B25035", "B25035001")),
                    "taxesPaid": pos(g("B25103", "B25103001"))}
    return out, {"name": rel.get("name") or "ACS 5-year", "years": rel.get("years")}


def nri(tracts):
    fields = "TRACTFIPS,RISK_SCORE,RISK_RATNG," + ",".join(f"{h}_RISKS,{h}_RISKR" for h in HAZARDS)
    where = "TRACTFIPS IN (" + ",".join(f"'{t}'" for t in sorted(tracts)) + ")"
    v = fetch("fema_nri", "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0/query",
              params={"where": where, "outFields": fields, "returnGeometry": "false", "f": "json"})
    out = {}
    for f in (v or {}).get("features") or []:
        a = f["attributes"]
        top = sorted(({"hazard": HAZARDS[h], "score": round(a.get(f"{h}_RISKS") or 0), "rating": a.get(f"{h}_RISKR")} for h in HAZARDS if a.get(f"{h}_RISKS")),
                     key=lambda x: (-RATING_RANK.get(x["rating"], 0), -x["score"]))[:3]
        out[a["TRACTFIPS"]] = {"score": round(a["RISK_SCORE"]) if a.get("RISK_SCORE") is not None else None, "rating": a.get("RISK_RATNG"), "top": top}
    return out


def flood_zone(lat, lon):
    v = fetch("fema_nfhl", "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
              params={"geometry": f"{lon:.5f},{lat:.5f}", "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                      "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF", "returnGeometry": "false", "f": "json"})
    if v is None or "features" not in v:
        return None
    if not v["features"]:
        return {"zone": None, "sfha": False, "label": "No mapped flood zone at this point"}
    a = v["features"][0]["attributes"]
    z = a.get("FLD_ZONE") or ""
    sfha = z[:1] in ("A", "V")
    sub = (a.get("ZONE_SUBTY") or "").title()
    label = (f"Flood zone {z}: high risk area" if sfha else f"Flood zone {z}" + (f" ({sub.lower()})" if sub else ": outside the high risk area"))
    return {"zone": z, "sfha": sfha, "label": label, "note": "Flood insurance likely required by lenders" if sfha else None}


def eia_price(state):
    txt = fetch("eia", "https://www.eia.gov/electricity/monthly/epm_table_grapher.php", params={"t": "epmt_5_6_a"}, kind="text")
    if not txt:
        return None
    i = txt.find(">" + state + "<")
    month = re.search(r"by State, ((?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d)", re.sub(r"<[^>]+>", " ", txt))
    if i < 0:
        return None
    nums = re.findall(r">\s*([\d.]+)\s*<", txt[i:i + 600])
    return {"cents": float(nums[0]), "month": month.group(1) if month else None} if nums else None


def eia_use(state):
    """Average monthly household electricity use by state (EIA sales, revenue and price, table 5A)."""
    for year in (2025, 2024, 2023):
        b = None
        for url in ("https://www.eia.gov/electricity/sales_revenue_price/xls/table_5A.xlsx",):
            b = fetch("eia_use", url, kind="bytes", params={"y": year} if year != 2025 else None, tries=1)
            if b:
                break
        if not b:
            continue
        try:
            import openpyxl
            ws = openpyxl.load_workbook(io.BytesIO(bytes(b)), read_only=True, data_only=True).active
            title, val = "", None
            for row in ws.iter_rows(values_only=True):
                cells = [c for c in row if c is not None]
                if cells and isinstance(cells[0], str):
                    if re.search(r"20\d\d", cells[0]) and not title:
                        title = cells[0]
                    if cells[0].strip() == state and len(cells) >= 3:
                        val = float(cells[2])
            if val:
                y = re.search(r"20\d\d", title)
                return {"kwhMonth": val, "year": y.group(0) if y else None}
        except Exception as e:  # noqa: BLE001
            log(f"  eia table 5A: {type(e).__name__} {str(e)[:80]}")
        break
    return None


def fred_rate():
    txt = fetch("fred", "https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": "MORTGAGE30US", "d": TODAY}, kind="text")
    try:
        d, v = txt.strip().splitlines()[-1].split(",")
        return {"rate": float(v), "date": d}
    except Exception:  # noqa: BLE001
        return None


def pvwatts(lat, lon):
    key = os.environ.get("NREL_API_KEY") or "DEMO_KEY"
    v = fetch("pvwatts", "https://developer.nlr.gov/api/pvwatts/v8.json",
              params={"api_key": key, "lat": round(lat, 2), "lon": round(lon, 2), "system_capacity": 1, "module_type": 0, "losses": 14,
                      "array_type": 1, "tilt": 20, "azimuth": 180})
    try:
        return float(v["outputs"]["ac_annual"])
    except Exception:  # noqa: BLE001
        return None


def insurance_avg(state):
    """Average homeowners premium by state, from the Insurance Information Institute's public table (NAIC data)."""
    txt = fetch("iii", "https://www.iii.org/fact-statistic/facts-statistics-homeowners-and-renters-insurance", kind="text", headers={"User-Agent": "Mozilla/5.0"})
    if not txt:
        return None
    x = re.sub(r"<script.*?</script>", " ", txt, flags=re.S)
    x = re.sub(r"<[^>]+>", "|", x)
    x = re.sub(r"[|\s]{2,}", " | ", x)
    m = re.search(re.escape(state) + r"(?: \(\d\))? \| ([\d,]{3,6}) \| \d{1,2} \| ([\d,]{2,4}) \| \d{1,2} \|", x)
    if not m:
        return None
    head = x[:m.start()]
    y = re.findall(r"Average Premiums For Homeowners And Renters Insurance By State, (20\d\d)", head)
    return {"homeowners": int(m.group(1).replace(",", "")), "renters": int(m.group(2).replace(",", "")), "year": y[-1] if y else None}


# ------------------------------------------------------------------ money
def monthly_cost(price, rate_pct, down_pct, tax_year, ins_year, hoa, electric, solar_month=0):
    loan = price * (1 - down_pct / 100)
    r = rate_pct / 100 / 12
    pi = loan * r / (1 - (1 + r) ** -360) if r else loan / 360
    parts = {"mortgage": round(pi), "tax": round((tax_year or 0) / 12), "insurance": round((ins_year or 0) / 12), "hoa": round(hoa or 0), "electric": round(electric or 0)}
    return {**parts, "solar": -round(solar_month or 0), "total": round(sum(parts.values()) - (solar_month or 0)), "downPct": down_pct, "down": round(price * down_pct / 100)}


def poly_area_m2(coords, lat):
    kx = 111320 * math.cos(math.radians(lat))
    a = 0
    for i in range(len(coords) - 1):
        x1, y1 = coords[i][0] * kx, coords[i][1] * 111320
        x2, y2 = coords[i + 1][0] * kx, coords[i + 1][1] * 111320
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


# ------------------------------------------------------------------ mock context (synthetic, offline)
def mock_context(area, listings, out):
    rnd = random.Random(7)
    w, s, e, n = area["bbox"]
    homes = [{"id": l["id"], "lat": l["lat"], "lon": l["lon"], "price": l["price"], "rent": False, "sold": l["kind"] == "sold", "beds": l["beds"],
              "baths": l["baths"], "sqft": l["sqft"], "ptype": "House", "status": "Sold" if l["kind"] == "sold" else "For sale", "date": TODAY}
             for l in listings if l.get("price") and l.get("sqft")]
    apts = [{"id": l["id"], "name": l.get("name") or l["address"], "lat": l["lat"], "lon": l["lon"], "units": l.get("unitsAvailable"), "total": l.get("totalUnits"),
             "manager": l.get("manager"), "yearBuilt": l.get("yearBuilt"), "amenities": (l.get("highlights") or [])[:8],
             "plans": [{"name": f.get("name"), "beds": f.get("beds"), "baths": f.get("baths"), "sqft": f.get("sqft"), "rentMin": f.get("rentMin") or 0,
                        "rentMax": f.get("rentMax") or 0, "units": f.get("unitsAvailable") or 0} for f in l.get("floorPlans") or []]}
            for l in listings if l["kind"] == "apartments"]
    com = []
    for c in json.loads((out / "commercial.json").read_text(encoding="utf-8")):
        com.append({"id": c["id"], "lat": c["lat"], "lon": c["lon"], "type": c.get("type") or "Retail", "name": c.get("name"), "built": rnd.choice([None, 1998, 2012, 2023]),
                    "sqft": c.get("sqft"), "tenants": [{"name": f"{c.get('name')} tenant {i + 1}", "employees": rnd.randint(4, 120)} for i in range(c.get("tenants") or 0)],
                    "sales": [{"date": f"{rnd.choice([2019, 2025, 2026])}-05-01", "price": rnd.randint(2, 30) * 500000}] if rnd.random() < 0.5 else []})
    near = json.loads((out / "nearby.json").read_text(encoding="utf-8"))
    pt = lambda: {"lat": rnd.uniform(s, n), "lon": rnd.uniform(w, e)}  # noqa: E731
    names = {"supermarket": ["Finch Market", "Wren Grocer", "Lark Foods"], "school": ["Heron Elementary", "Mockingbird High"], "park": ["Robin Park", "Sparrow Green", "Kite Field"],
             "transit": ["Bus stop"], "gym": ["Falcon Fitness"], "pharmacy": ["Dove Pharmacy"], "hospital": ["Mockingbird General"], "cafe": ["Owl Coffee", "Jay Cafe"],
             "restaurant": ["Swift Diner", "Tern Tacos", "Crane Noodles"]}
    pois = {k: [] for k in list(GENERIC) + ["shopfront"]}
    for cat, src in (("park", "park"), ("school", "school"), ("supermarket", "shopping center")):
        for i, p in enumerate(near.get(src) or []):
            pois[cat].append({"name": names[cat][i % len(names[cat])], "lat": p["lat"], "lon": p["lon"]})
    for cat, count in (("transit", 14), ("gym", 3), ("pharmacy", 3), ("hospital", 1), ("cafe", 7), ("restaurant", 12), ("shopfront", 60)):
        for i in range(count):
            pois[cat].append({"name": names.get(cat, ["Shop"])[i % len(names.get(cat, ["Shop"]))], **pt()})
    lat0, lon0 = area["center"]
    lines = {"highway": [{"name": "Route 9", "pts": [(n + 0.004, w - 0.01), (n + 0.004, e + 0.01)]}], "rail": [{"name": "Rail line", "pts": [(s - 0.01, e + 0.006), (n + 0.01, e + 0.006)]}]}
    airports = [{"name": "Mockingbird Regional", "lat": lat0 - 0.12, "lon": lon0 + 0.1}]
    return {"homes": homes, "raw": {}, "apts": apts, "commercial": com}, pois, lines, airports


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True, choices=["la", "houston", "mock"])
    args = ap.parse_args()
    city, mock = args.city, args.city == "mock"
    load_env()
    out = PUBLIC_DATA / city
    area = json.loads((out / "area.json").read_text(encoding="utf-8"))
    listings = json.loads((out / "listings.json").read_text(encoding="utf-8"))
    blds = {f["properties"]["id"]: f for f in json.loads((out / "buildings.geojson").read_text(encoding="utf-8"))["features"]}
    lat0, lon0 = area["center"]
    log(f"{city}: {len(listings)} listings")
    src = {}

    # ---- context: kit (real) or synthetic (mock)
    if mock:
        kit, pois, lines, airports = mock_context(area, listings, out)
        src["places"] = {"name": "Synthetic demo data", "date": TODAY, "how": "Made up places for the mock neighborhood. Times are distance at 25 mph driving or 3 mph walking (Estimate)."}
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parent / "sponsor"))
        from kit_insights import kit_context
        kit = kit_context(area, {str(l["id"]) for l in listings})
        log(f"  kit: {len(kit['homes'])} homes, {len(kit['apts'])} apartment communities, {len(kit['commercial'])} commercial properties within reach")
        pois, lines, airports, ok = osm_places(area)
        note("OpenStreetMap places", ok)
        src["places"] = {"name": "OpenStreetMap contributors", "date": TODAY,
                         "how": "Nearest places by straight line distance. Drive times assume 25 mph and walk times 3 mph on a route 1.3 times the straight line (Estimate)."}

    # ---- city wide numbers
    g = GEO.get(city)
    money = {}
    if mock:
        rate = {"rate": 6.9, "date": TODAY}
        price_kwh = {"cents": 24.0, "month": "mock"}
        use = {"kwhMonth": 700, "year": "mock"}
        ins = {"homeowners": 1600, "renters": 180, "year": "mock"}
        pv = 1550.0
        tax_rate, tax_how = 1.1, "Synthetic demo value"
        city_acs, acs_rel, tract_of, acs_by = {"income": 82000, "homeValue": 690000, "grossRent": 1900, "ownerShare": 52, "medianYearBuilt": 1988}, {"name": "Synthetic demo data", "years": ""}, {}, {}
        nri_by = {}
    else:
        rate = fred_rate()
        note("FRED mortgage rate", bool(rate))
        price_kwh = eia_price(g["state"])
        note("EIA electricity price", bool(price_kwh))
        use = eia_use(g["state"])
        note("EIA household use", bool(use))
        ins = insurance_avg(g["state"])
        note("Insurance state average (III/NAIC)", bool(ins))
        pv = pvwatts(lat0, lon0)
        note("NREL PVWatts", bool(pv))
        tract_of = {}
        for l in listings:
            tract_of[l["id"]] = census_tract(l["lat"], l["lon"])
            note("Census tract", bool(tract_of[l["id"]]))
        tracts = {t for t in tract_of.values() if t}
        acs_by, acs_rel = acs({g["place"], g["county"]} | {"14000US" + t for t in tracts})
        city_acs = acs_by.get(g["place"]) or {}
        county = acs_by.get(g["county"]) or {}
        nri_by = nri(tracts) if tracts else {}
        if city == "la":
            tax_rate = 1.2
            tax_how = "California's 1% general levy (Constitution Art. XIII A) plus voter approved local rates, about 1.2% of the purchase price in the City of Los Angeles (Los Angeles County Auditor-Controller tax rate tables, 2025-26)."
        else:
            tax_rate = round(100 * county["taxesPaid"] / county["homeValue"], 2) if county.get("taxesPaid") and county.get("homeValue") else None
            tax_how = f"Median real estate taxes paid divided by median home value in Harris County ({(acs_rel or {}).get('name', 'ACS')}). The listing's own tax figure is used when it has one."
    money = {"rate": rate, "taxRatePct": tax_rate, "insurance": ins, "priceKwh": price_kwh, "use": use, "pvKwhPerKw": pv}
    log(f"  money: {json.dumps(money)}")

    src.update({
        "value": {"name": "CoStar data kit (Homes.com listings)" if not mock else "Synthetic demo data", "date": TODAY,
                  "how": "Price per square foot against homes of the same type nearby that are for sale now or sold in the last year."},
        "rentVsBuy": {"name": "CoStar data kit (Apartments.com listings)" if not mock else "Synthetic demo data", "date": TODAY,
                      "how": "Median asking rent of floor plans with the same bedroom count in apartment communities within 2 km."},
        "cost": {"name": "FRED, county tax data, Insurance Information Institute, EIA, listing HOA", "date": (rate or {}).get("date"),
                 "how": f"Estimate. 30 year fixed loan at the Freddie Mac average rate ({(rate or {}).get('rate')}%, week of {(rate or {}).get('date')}), plus property tax, the state average insurance premium, HOA and the electric estimate. Mortgage insurance for small down payments is not included."},
        "tax": {"name": "Property tax", "date": "2025", "how": tax_how},
        "insurance": {"name": "Insurance Information Institute (NAIC data)", "date": (ins or {}).get("year"),
                      "how": "Estimate. The state average homeowners premium, not a quote. The pressure label comes from FEMA's risk rating for the census tract and the flood zone."},
        "energy": {"name": "U.S. Energy Information Administration", "date": (price_kwh or {}).get("month"),
                   "how": f"Estimate. The state's average household electricity use ({(use or {}).get('kwhMonth')} kWh a month, {(use or {}).get('year')}) scaled by this home's floor area against an 1,800 sq ft home (limited to between half and double), times the state's average residential price."},
        "solar": {"name": "NREL PVWatts and Vexcel roof data" if not mock else "Synthetic demo data", "date": TODAY,
                  "how": "Estimate. 60% of the roof area seen from the air is treated as usable for 400 W panels. Yearly output is from NREL PVWatts for this location, reduced for tree cover. Savings count only power the home would use itself."},
        "risk": {"name": "FEMA National Risk Index and FEMA flood maps" if not mock else "Synthetic demo data", "date": TODAY,
                 "how": "The risk index compares this census tract with every tract in the country. The flood zone is the mapped zone at the home's location."},
        "census": {"name": f"U.S. Census Bureau, {(acs_rel or {}).get('name', 'ACS 5-year')}" if not mock else "Synthetic demo data", "date": (acs_rel or {}).get("years"),
                   "how": "Values for the census tract the home is in, next to the same value for the whole city."},
        "activity": {"name": "CoStar data kit (commercial properties, tenants, sales) and OpenStreetMap" if not mock else "Synthetic demo data", "date": TODAY,
                     "how": "Commercial buildings, current tenants and sales within 1.5 km, and shops and places to eat within a 10 minute walk (800 m)."},
        "aerial": {"name": "Vexcel aerial data" if not mock else "Synthetic demo data", "date": TODAY, "how": "Read from the aerial image: roof, pool, solar panels and tree cover. Roof condition is Vexcel's 1 to 5 rating (5 is best)."},
        "noise": {"name": "OpenStreetMap contributors" if not mock else "Synthetic demo data", "date": TODAY, "how": "Straight line distance to the nearest highway, rail line and airport."},
        "home": {"name": "CoStar data kit (listing features)" if not mock else "Synthetic demo data", "date": TODAY, "how": "Taken from the listing's own feature text."},
        "scores": {"name": "Grand Property Auto", "date": TODAY, "how": "Each score is 0 to 100 from the facts on its card. The formulas are in docs/SCORES.md."},
    })

    two_years = (dt.date.today() - dt.timedelta(days=730)).isoformat()
    year_ago = (dt.date.today() - dt.timedelta(days=370)).isoformat()
    index, results = [], []

    for l in listings:
        try:
            lat, lon, lid = l["lat"], l["lon"], str(l["id"])
            raw = kit["raw"].get(lid, {})
            ins_out = {"id": lid, "city": city, "kind": l["kind"], "generated": TODAY, "mock": mock or None}
            is_home = l["kind"] in ("sale", "sold") and bool(l.get("price"))
            sqft = l.get("sqft") or None
            ppsf = round(l["price"] / sqft) if is_home and sqft else None
            tx_asking = l.get("state") == "TX" and l["kind"] == "sold" and not l.get("rent")
            ins_out["facts"] = {"price": l.get("price"), "rent": l.get("rent"), "priceLabel": "Last asking price (Texas does not disclose sale prices)" if tx_asking else l.get("priceLabel"),
                                "askingOnly": tx_asking, "beds": l.get("beds"), "baths": l.get("baths"), "sqft": sqft, "lotAcres": l.get("lotAcres"),
                                "yearBuilt": l.get("yearBuilt"), "ppsf": ppsf, "daysOnMarket": raw.get("dom"), "type": raw.get("ptype")}

            # 1. value vs nearby
            value = None
            if ppsf:
                for radius in (1000, 2000, 3500):
                    comps = [h for h in kit["homes"] if h["id"] != lid and not h["rent"] and h.get("sqft") and h["price"] > 20000
                             and (not raw.get("ptype") or not h.get("ptype") or h["ptype"] == raw["ptype"])
                             and (not h["sold"] or (h.get("date") or TODAY) >= year_ago) and hav(lat, lon, h["lat"], h["lon"]) <= radius]
                    if len(comps) >= 4:
                        break
                if comps:
                    cp = [h["price"] / h["sqft"] for h in comps]
                    higher = round(100 * sum(1 for x in cp if x > ppsf) / len(cp))
                    close = sorted(comps, key=lambda h: hav(lat, lon, h["lat"], h["lon"]))[:5]
                    value = {"ppsf": ppsf, "n": len(comps), "radiusKm": radius / 1000, "medianPpsf": round(med(cp)), "lowerThanPct": higher, "type": raw.get("ptype"),
                             "comps": [{"price": h["price"], "beds": h["beds"], "baths": h["baths"], "sqft": h["sqft"], "ppsf": round(h["price"] / h["sqft"]),
                                        "status": h["status"], "distM": round(hav(lat, lon, h["lat"], h["lon"]))} for h in close]}
            ins_out["value"] = value
            note("CoStar comps", bool(value) or not ppsf)

            # 2. rent vs buy / rent nearby
            beds = l.get("beds")
            rvb = None
            def plans_for(a, b):
                return [p for p in a["plans"] if p["beds"] == b and (p["rentMin"] or p["rentMax"])]
            if beds is not None:
                near_apts = [(hav(lat, lon, a["lat"], a["lon"]), a) for a in kit["apts"] if a["id"] != lid]
                near_apts = sorted((x for x in near_apts if x[0] <= 2000 and plans_for(x[1], beds)), key=lambda x: x[0])
                rents = [((p["rentMin"] or p["rentMax"]) + (p["rentMax"] or p["rentMin"])) / 2 for _, a in near_apts for p in plans_for(a, beds)]
                if rents:
                    rvb = {"beds": beds, "medianRent": round(med(rents)), "plans": len(rents), "communities": [
                        {"id": a["id"], "name": a["name"], "distM": round(d), "rentMin": min(p["rentMin"] or p["rentMax"] for p in plans_for(a, beds)),
                         "rentMax": max(p["rentMax"] or p["rentMin"] for p in plans_for(a, beds)), "units": sum(p["units"] for p in plans_for(a, beds))} for d, a in near_apts[:3]]}
            ins_out["rentVsBuy"] = rvb

            # 3. home facts from the listing's features
            sec = raw.get("sections") or l.get("features") or {}
            pick = lambda *names: [x for nme in names for x in sec.get(nme, [])][:8]  # noqa: E731
            comm = sec.get("_community") or pick("Overview", "Amenities", "Recreation", "Security")
            hoa_lines = [x for x in comm if "hoa" in x.lower() or "association" in x.lower()]
            ins_out["home"] = {
                "hoa": {"fee": l.get("hoa"), "name": raw.get("hoaName"), "lines": hoa_lines[:4]} if l.get("hoa") or hoa_lines else None,
                "community": [x for x in comm if x not in hoa_lines][:10], "parking": pick("Parking"), "utilities": pick("Utilities"),
                "kitchen": pick("Kitchen"), "laundry": pick("Laundry"), "outdoor": pick("Outdoor Features", "Pool"), "eco": pick("Eco-Friendly Details"),
                "schools": pick("Schools"), "highlights": (l.get("highlights") or [])[:8], "stories": raw.get("stories"),
                "priceHistory": raw.get("history") or [], "listDate": raw.get("listDate"),
            }

            # 4. apartment communities
            if l["kind"] == "apartments":
                a = next((x for x in kit["apts"] if x["id"] == lid), None) or {}
                plans = [p for p in (l.get("floorPlans") or [])]
                rents = [p["rentMin"] for p in plans if p.get("rentMin")]
                ins_out["apartment"] = {"rentMin": min(rents) if rents else None, "rentMax": max((p.get("rentMax") or 0 for p in plans), default=0) or None,
                                        "unitsAvailable": l.get("unitsAvailable"), "totalUnits": l.get("totalUnits"), "manager": l.get("manager"), "yearBuilt": l.get("yearBuilt"),
                                        "amenities": (a.get("amenities") or l.get("highlights") or [])[:14],
                                        "plans": [{"name": p.get("name"), "beds": p.get("beds"), "baths": p.get("baths"), "sqft": p.get("sqft"), "rentMin": p.get("rentMin") or None,
                                                   "rentMax": p.get("rentMax") or None, "units": p.get("unitsAvailable")} for p in plans[:12]]}

            # 5. neighborhood activity (commercial data within 1.5 km + shops within an 800 m walk)
            com = [c for c in kit["commercial"] if hav(lat, lon, c["lat"], c["lon"]) <= 1500]
            bt = {}
            for c in com:
                t = c["type"]
                k = "retail" if "Retail" in t else "office" if "Office" in t else "industrial" if t in ("Industrial", "Flex") else "apartments" if "Multi" in t else "other"
                bt[k] = bt.get(k, 0) + 1
            tenants = [t for c in com for t in c["tenants"]]
            emp = sorted((t for t in tenants if t.get("name") and t.get("employees")), key=lambda t: -t["employees"])
            seen_e, employers = set(), []
            for t in emp:
                if t["name"] not in seen_e:
                    seen_e.add(t["name"])
                    employers.append({"name": t["name"], "employees": t["employees"]})
                if len(employers) >= 5:
                    break
            sales = [s for c in com for s in c["sales"] if s["date"] >= two_years]
            new5 = sum(1 for c in com if c.get("built") and c["built"] >= dt.date.today().year - 5)
            shops = sum(1 for p in pois["shopfront"] if hav(lat, lon, p["lat"], p["lon"]) <= 800)
            facts = []
            if shops:
                facts.append(f"{shops} shops and places to eat within a 10 minute walk")
            if com:
                facts.append(f"{len(com)} commercial buildings within 1.5 km" + (f", {bt['retail']} of them retail" if bt.get("retail") else ""))
            if tenants:
                facts.append(f"{len(tenants)} businesses renting space nearby")
            if sales:
                vol = sum(s["price"] or 0 for s in sales)
                facts.append(f"{len(sales)} commercial buildings sold nearby in the last 2 years" + (f" (${vol / 1e6:.0f}M where the price is known)" if vol >= 1e6 else ""))
            if new5:
                facts.append(f"{new5} commercial buildings finished in the last 5 years")
            ins_out["activity"] = {"shopsWalk": shops, "buildings": {**bt, "total": len(com)}, "tenants": len(tenants), "employers": employers,
                                   "sales2y": {"count": len(sales), "volume": sum(s["price"] or 0 for s in sales)}, "new5y": new5, "facts": facts}

            # 6. aerial facts
            v = l.get("vexcel") or {}
            b = blds.get(l.get("buildingId"))
            foot = None
            if b and b["geometry"]["type"] == "Polygon":
                foot = poly_area_m2(b["geometry"]["coordinates"][0], lat)
            bp = (b or {}).get("properties", {})
            ins_out["aerial"] = {"roofMaterial": v.get("roofMaterial"), "roofShape": bp.get("roofShape"), "roofCondition": v.get("roofCondition"), "solar": bool(v.get("solar")),
                                 "pool": bool(v.get("poolDetected")), "poolAreaSqft": v.get("poolAreaSqft") or None, "treeCoverPct": v.get("treeCoverPct"),
                                 "lotSqft": round(l["lotAcres"] * 43560) if l.get("lotAcres") else None, "footprintSqft": round(foot * 10.764) if foot else None,
                                 "nearby": l.get("nearby") or {}}

            # 7, 8. places, times, rings
            places = {cat: nearest(lat, lon, pois[cat]) for cat in GENERIC}
            ins_out["places"] = places
            dlat, dlon, dname = DOWNTOWN[city]
            dd = hav(lat, lon, dlat, dlon)
            ins_out["drive"] = {"downtown": {"name": dname, "km": round(dd / 1000, 1), "min": drive_min(dd), "est": True}, "source": "Estimate from distance at 25 mph"}
            ins_out["rings"] = {"walk": [{"min": m, "radiusM": round(m * WALK_M_PER_MIN / DETOUR)} for m in (5, 10, 15)],
                                "drive": [{"min": m, "radiusM": round(m * DRIVE_M_PER_MIN / DETOUR)} for m in (5, 10, 15)], "est": True}
            hd, hn = dist_to_lines(lat, lon, lines["highway"])
            rd, rn = dist_to_lines(lat, lon, lines["rail"])
            apn = min(airports, key=lambda a: hav(lat, lon, a["lat"], a["lon"])) if airports else None
            ins_out["noise"] = {"highway": {"distM": hd, "name": hn} if hd is not None else None, "rail": {"distM": rd, "name": rn} if rd is not None else None,
                                "airport": {"distM": round(hav(lat, lon, apn["lat"], apn["lon"])), "name": apn["name"]} if apn else None}

            # 9. census
            if mock:
                rr = random.Random(lid)
                tract = None
                cen = {"income": rr.randrange(55000, 130000, 1000), "homeValue": rr.randrange(450000, 990000, 5000), "grossRent": rr.randrange(1400, 2800, 10),
                       "ownerShare": rr.randrange(30, 75), "medianYearBuilt": rr.randrange(1962, 2012)}
            else:
                tract = tract_of.get(l["id"])
                cen = acs_by.get("14000US" + tract) if tract else None
            ins_out["census"] = {"tract": tract, **{k: cen.get(k) for k in ("income", "homeValue", "grossRent", "ownerShare", "medianYearBuilt")},
                                 "city": {k: city_acs.get(k) for k in ("income", "homeValue", "grossRent", "ownerShare", "medianYearBuilt")}} if cen else None
            note("Census ACS", bool(cen))

            # 10. risk
            if mock:
                rr = random.Random(lid + "r")
                sc = rr.randrange(20, 90)
                nr = {"score": sc, "rating": "Relatively High" if sc > 70 else "Relatively Moderate" if sc > 45 else "Relatively Low",
                      "top": [{"hazard": h, "score": rr.randrange(30, 99), "rating": "Relatively Moderate"} for h in rr.sample(["Wildfire", "Earthquake", "Heat wave", "Inland flooding", "Drought"], 3)]}
                in_zone = rr.random() < 0.12
                fl = {"zone": "AE" if in_zone else "X", "sfha": in_zone, "label": "Flood zone AE: high risk area" if in_zone else "Flood zone X: outside the high risk area",
                      "note": "Flood insurance likely required by lenders" if in_zone else None}
            else:
                nr = nri_by.get(tract) if tract else None
                fl = flood_zone(lat, lon)
            note("FEMA risk index", bool(nr))
            note("FEMA flood zone", fl is not None)
            rating = (nr or {}).get("rating") or ""
            tier = None
            if nr or fl:
                tier = "higher" if (fl or {}).get("sfha") or "High" in rating else "lower" if "Low" in rating else "about average"
            ins_out["risk"] = {"nri": nr, "flood": fl, "tier": tier,
                               "insurancePressure": f"Insurance cost pressure: {tier}{' than' if tier != 'about average' else ' for'} the state" if tier else None}

            # 11. energy
            energy = None
            if sqft and price_kwh and use:
                kwh = use["kwhMonth"] * 12 * clamp(sqft / 1800, 0.5, 2)
                energy = {"kwhYear": round(kwh), "priceCents": price_kwh["cents"], "priceMonth": price_kwh["month"], "billMonth": round(kwh * price_kwh["cents"] / 100 / 12), "est": True}
            ins_out["energy"] = energy

            # 12. solar
            solar = None
            shared = bool(foot and sqft and foot * 10.764 > 1.6 * sqft * max(1, raw.get("stories") or 1) and l["kind"] != "apartments") or l["kind"] == "apartments" or raw.get("condoBuilding")
            if l["kind"] != "apartments" and foot and pv and energy and not shared:
                panels = int(min(foot * 0.6 / PANEL_M2, 60))
                shade = 1 - 0.5 * (v.get("treeCoverPct") or 0) / 100
                cap_panels = math.ceil(energy["kwhYear"] / (PANEL_W / 1000 * pv * shade)) if pv else panels
                use_panels = max(0, min(panels, cap_panels))
                kwh = use_panels * PANEL_W / 1000 * pv * shade
                if use_panels >= 4:
                    cover = round(100 * min(1, kwh / energy["kwhYear"]))
                    save = round(min(kwh, energy["kwhYear"]) * price_kwh["cents"] / 100)
                    solar = {"source": "NREL PVWatts + Vexcel roof", "fits": panels, "panels": use_panels, "kw": round(use_panels * PANEL_W / 1000, 1), "kwhYear": round(kwh),
                             "coverPct": cover, "savingsYear": save, "existing": bool(v.get("solar")), "est": True,
                             "line": f"Fits about {panels} panels, {use_panels} could cover about {cover}% of the power bill, saving about ${save:,} a year (Estimate)"}
            ins_out["solar"] = solar or {"available": False, "existing": bool(v.get("solar")),
                                         "why": "Shared roof: solar is a building decision" if shared else "Not available for this home"}
            note("Solar estimate", bool(solar) or shared)

            # 13, 14. money
            cost = None
            if is_home and rate:
                if raw.get("taxes") and l.get("state") == "TX":
                    tax_year, tax_src = raw["taxes"], "From the listing"
                else:
                    tax_year, tax_src = (l["price"] * tax_rate / 100 if tax_rate else None), f"{tax_rate}% of the price (Estimate)" if tax_rate else None
                cost = monthly_cost(l["price"], rate["rate"], 20, tax_year, (ins or {}).get("homeowners"), l.get("hoa"), (energy or {}).get("billMonth"))
                cost.update({"price": l["price"], "ratePct": rate["rate"], "rateDate": rate["date"], "taxYear": round(tax_year) if tax_year else None, "taxSource": tax_src,
                             "insuranceYear": (ins or {}).get("homeowners"), "insuranceDataYear": (ins or {}).get("year"),
                             "solarMonth": round(solar["savingsYear"] / 12) if solar else 0, "est": True})
            ins_out["cost"] = cost

            # 15. scores
            def first(cat, key):
                p = places.get(cat) or []
                return p[0][key] if p else None
            S = {}
            sm, ph, cf = first("supermarket", "driveMin"), first("pharmacy", "driveMin"), first("cafe", "driveMin")
            if sm is not None:
                f = lambda m: clamp(100 - 10 * max(0, (m if m is not None else 12) - 2))  # noqa: E731
                S["errands"] = {"score": round(0.5 * f(sm) + 0.25 * f(ph) + 0.25 * f(cf)),
                                "reason": f"Supermarket about {sm} min drive" + (f", {first('supermarket', 'walkMin')} min walk" if first("supermarket", "walkMin") <= 12 else "")}
            tw = first("transit", "walkMin")
            dmin = ins_out["drive"]["downtown"]["min"]
            S["commute"] = {"score": round(0.6 * clamp(100 - 3 * max(0, dmin - 10)) + 0.4 * clamp(100 - 6 * max(0, (tw if tw is not None else 20) - 3))),
                            "reason": f"About {dmin} min drive to {dname}" + (f", transit stop {tw} min walk" if tw is not None else "")}
            pw = first("park", "walkMin")
            tree = v.get("treeCoverPct") or 0
            S["outdoors"] = {"score": round(0.6 * clamp(100 - 5 * max(0, (pw if pw is not None else 25) - 3)) + 0.25 * min(100, tree * 4) + 0.15 * (100 if v.get("poolDetected") else 0)),
                             "reason": (f"Park {pw} min walk" if pw is not None else "No park found nearby") + (", pool seen from the air" if v.get("poolDetected") else "") + (f", {tree}% tree cover" if tree >= 10 else "")}
            if energy:
                rc = v.get("roofCondition")
                S["energy"] = {"score": round(0.5 * clamp(100 - (energy["billMonth"] - 80) / 2.2) + 0.35 * (solar["coverPct"] if solar else 0) + 0.15 * (rc / 5 * 100 if rc else 50)),
                               "reason": f"Electric bill about ${energy['billMonth']} a month" + (f", solar could cover {solar['coverPct']}%" if solar else "")}
            vs, vparts = [], []
            if value and value["n"] >= 3:
                vs.append((0.7, value["lowerThanPct"]))
                vparts.append(f"Priced lower than {value['lowerThanPct']}% of similar homes nearby")
            if cost and rvb:
                vs.append((0.3, clamp(50 + 50 * (rvb["medianRent"] - cost["total"]) / rvb["medianRent"])))
                vparts.append(f"renting a similar {beds} bed nearby is about ${rvb['medianRent']:,} a month")
            if l["kind"] in ("apartments", "rent") and not vs:
                mine = (ins_out.get("apartment") or {}).get("rentMin") or l.get("rent")
                others = [min(p["rentMin"] or p["rentMax"] for p in a["plans"] if p["rentMin"] or p["rentMax"]) for a in kit["apts"]
                          if a["id"] != lid and hav(lat, lon, a["lat"], a["lon"]) <= 2000 and any(p["rentMin"] or p["rentMax"] for p in a["plans"])]
                if mine and len(others) >= 3:
                    pct = round(100 * sum(1 for x in others if x > mine) / len(others))
                    vs.append((1, pct))
                    vparts.append(f"Starting rent is lower than {pct}% of communities within 2 km")
            if vs:
                S["value"] = {"score": round(sum(w * x for w, x in vs) / sum(w for w, _ in vs)), "reason": "; ".join(vparts)}
            if nr and nr.get("score") is not None:
                S["risk"] = {"score": round(clamp(100 - nr["score"] - (30 if (fl or {}).get("sfha") else 0))),
                             "reason": f"FEMA rates this area {rating.lower()} for natural hazards" + ("; in a high risk flood zone" if (fl or {}).get("sfha") else "; outside the high risk flood zone" if fl else "")}
            S["activity"] = {"score": round(0.5 * min(100, shops * 2.5) + 0.3 * min(100, len(tenants) / 2) + 0.2 * min(100, len(sales) * 8 + new5 * 10)),
                             "reason": facts[0] if facts else "Little commercial activity nearby"}
            ins_out["scores"] = S

            (out / "insights").mkdir(exist_ok=True)
            (out / "insights" / f"{lid}.json").write_text(json.dumps(ins_out), encoding="utf-8")
            results.append(ins_out)
            index.append({
                "id": lid, "kind": l["kind"], "price": l.get("price"), "rent": l.get("rent") or (ins_out.get("apartment") or {}).get("rentMin"), "beds": beds, "baths": l.get("baths"),
                "sqft": sqft, "lotAcres": l.get("lotAcres"), "hoa": l.get("hoa"), "ppsf": ppsf, "lowerThanPct": (value or {}).get("lowerThanPct"),
                "cost": (cost or {}).get("total"), "costParts": {k: cost[k] for k in ("mortgage", "tax", "insurance", "hoa", "electric")} if cost else None,
                "taxYear": (cost or {}).get("taxYear"), "rentNearby": (rvb or {}).get("medianRent"), "bill": (energy or {}).get("billMonth"),
                "solarSave": (solar or {}).get("savingsYear"), "solarCover": (solar or {}).get("coverPct"), "pool": bool(v.get("poolDetected")), "tree": tree,
                "roof": v.get("roofCondition"), "floodZone": (fl or {}).get("zone"), "sfha": (fl or {}).get("sfha"), "riskTier": tier, "riskScore": (nr or {}).get("score"),
                "superDrive": sm, "superWalk": first("supermarket", "walkMin"), "parkWalk": pw, "parkDrive": first("park", "driveMin"), "transitWalk": tw, "downtownMin": dmin,
                "shopsWalk": shops, "scores": {k: s["score"] for k, s in S.items()},
            })
        except Exception as e:  # noqa: BLE001
            import traceback
            log(f"  listing {l.get('id')} failed: {type(e).__name__} {e}")
            traceback.print_exc()

    (out / "insights" / "index.json").write_text(json.dumps(index), encoding="utf-8")
    area["insights"] = {"generated": TODAY, "sources": src, "money": money, "city": city_acs, "downtown": {"lat": DOWNTOWN[city][0], "lon": DOWNTOWN[city][1], "name": DOWNTOWN[city][2]},
                        "mock": mock or None}
    (out / "area.json").write_text(json.dumps(area), encoding="utf-8")

    log(f"wrote {len(results)} insight files for {city}")
    print(f"\n{'source':38} {'ok':>4} {'of':>4}")
    for k, (a, b) in coverage.items():
        print(f"{k:38} {a:>4} {b:>4}")
    full = lambda key: sum(1 for r in results if r.get(key))  # noqa: E731
    for key in ("value", "rentVsBuy", "census", "energy", "cost"):
        print(f"{'insight: ' + key:38} {full(key):>4} {len(results):>4}")
    print(f"{'insight: solar estimate':38} {sum(1 for r in results if r['solar'].get('panels')):>4} {len(results):>4}")


if __name__ == "__main__":
    main()
