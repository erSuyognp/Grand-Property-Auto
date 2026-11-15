"""Build the synthetic mock neighborhood in public/data/mock/.

Everything here is invented: street grid, lots, house footprints, a procedural ground
texture, 80 listings with made up addresses and prices, and procedural "interior" cube maps
instead of Matterport scans. It contains ZERO Sponsor Data and never reads the kit.
Same file formats as tools/build_city.py, so GAME_MODE=mock exercises the same game code.
"""
import json
import math
import random
import shutil
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from common import PUBLIC_DATA

OUT = PUBLIC_DATA / "mock"
SEED = 2026
SIZE_M = 1500.0
HALF = SIZE_M / 2
LAT0, LON0 = 35.0, -100.0  # an arbitrary point; nothing real is modeled here
M_PER_DEG = 111_320.0
K = math.cos(math.radians(LAT0))
TEX = 4096

rng = random.Random(SEED)
nrng = np.random.default_rng(SEED)


def ll(x, y):
    """Local meters (x east, y north) to [lon, lat]."""
    return [round(LON0 + x / (M_PER_DEG * K), 7), round(LAT0 + y / M_PER_DEG, 7)]


def px(x, y):
    return ((x + HALF) / SIZE_M * TEX, (HALF - y) / SIZE_M * TEX)


def rect(cx, cy, w, d):
    return [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]


def font(size):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------- layout
ROAD = 12.0
BLOCK_W, BLOCK_D = 150.0, 84.0
PITCH_X, PITCH_Y = BLOCK_W + ROAD, BLOCK_D + ROAD
NX, NY = int(SIZE_M // PITCH_X), int(SIZE_M // PITCH_Y)
OFF_X = -(NX * PITCH_X - ROAD) / 2
OFF_Y = -(NY * PITCH_Y - ROAD) / 2
STREETS_EW = ["Maple", "Juniper", "Wren", "Lark", "Sage", "Clover", "Poppy", "Alder", "Finch", "Willow", "Heron",
              "Aspen", "Cedar", "Briar", "Fern", "Hazel", "Linden", "Marigold"]
STREETS_NS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"]
ROOFS = [(141, 101, 84), (112, 112, 118), (156, 132, 110), (96, 84, 80), (172, 150, 128), (126, 92, 70), (140, 140, 132)]

buildings, trees, pools, parks, lots = [], [], [], [], []
special = {}
cells = [(i, j) for i in range(NX) for j in range(NY)]
rng.shuffle(cells)
for kind, n in (("park", 5), ("school", 2), ("shops", 3), ("apartments", 8), ("tennis", 2), ("pond", 1)):
    for _ in range(n):
        special[cells.pop()] = kind

bid = 0
for i in range(NX):
    for j in range(NY):
        bx = OFF_X + i * PITCH_X + BLOCK_W / 2
        by = OFF_Y + j * PITCH_Y + BLOCK_D / 2
        kind = special.get((i, j), "homes")
        street = STREETS_EW[j % len(STREETS_EW)]
        if kind == "park" or kind == "tennis" or kind == "pond":
            parks.append({"kind": kind, "x": bx, "y": by})
            for _ in range(28 if kind == "park" else 10):
                trees.append((bx + rng.uniform(-70, 70), by + rng.uniform(-38, 38), rng.uniform(0.9, 1.6)))
            continue
        if kind in ("school", "shops", "apartments"):
            if kind == "apartments":
                for sx in (-38, 38):
                    bid += 1
                    buildings.append({"id": bid, "poly": rect(bx + sx, by, 60, 44), "h": rng.choice([14, 17, 20, 24]),
                                      "type": "apartments", "roof": (150, 150, 148), "mat": "membrane", "shape": "flat",
                                      "block": (i, j), "cx": bx + sx, "cy": by})
                pools.append((bx, by, 60.0))
            else:
                bid += 1
                buildings.append({"id": bid, "poly": rect(bx, by + 8, 110, 46), "h": 9 if kind == "shops" else 11,
                                  "type": kind, "roof": (168, 166, 160), "mat": "membrane", "shape": "flat",
                                  "block": (i, j), "cx": bx, "cy": by + 8})
            parks.append({"kind": kind, "x": bx, "y": by})
            continue
        n_lots = 6
        lot_w = BLOCK_W / n_lots
        for row, sgn in ((0, -1), (1, 1)):
            for c in range(n_lots):
                lx = bx - BLOCK_W / 2 + lot_w * (c + 0.5)
                ly = by + sgn * BLOCK_D / 4
                w, d = rng.uniform(11, 16), rng.uniform(9, 13)
                hx = lx + rng.uniform(-2, 2)
                hy = ly + sgn * rng.uniform(4, 8)  # pushed toward the street edge
                poly = rect(hx, hy, w, d)
                if rng.random() < 0.35:  # L shape: add a garage wing
                    gw, gd = rng.uniform(5, 7), rng.uniform(5, 7)
                    x0, y0 = hx - w / 2, hy - d / 2
                    if sgn > 0:
                        poly = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + d + gd), (x0 + w - gw, y0 + d + gd),
                                (x0 + w - gw, y0 + d), (x0, y0 + d)]
                    else:
                        poly = [(x0, y0), (x0 + w - gw, y0), (x0 + w - gw, y0 - gd), (x0 + w, y0 - gd),
                                (x0 + w, y0 + d), (x0, y0 + d)]
                bid += 1
                has_pool = rng.random() < 0.22
                tree_pct = round(rng.uniform(4, 55))
                b = {"id": bid, "poly": poly, "h": rng.choice([4.5, 5, 5.5, 7.5, 8]), "type": "house",
                     "roof": rng.choice(ROOFS), "mat": rng.choice(["shingle", "shingle", "tile", "metal"]),
                     "shape": rng.choice(["gable", "hip"]), "solar": rng.random() < 0.12, "pool": has_pool,
                     "poolArea": round(rng.uniform(22, 48), 1) if has_pool else 0, "treePct": tree_pct,
                     "block": (i, j), "cx": hx, "cy": hy, "lot": (lx, ly, lot_w, BLOCK_D / 2), "sgn": sgn,
                     "street": street, "num": 100 * (i + 1) + 2 * c + row}
                buildings.append(b)
                back_y = ly - sgn * BLOCK_D / 8
                if has_pool:
                    pools.append((lx + rng.uniform(-3, 3), back_y, b["poolArea"]))
                for _ in range(int(tree_pct / 14)):
                    tx, ty = lx + rng.uniform(-lot_w / 2 + 1, lot_w / 2 - 1), back_y + rng.uniform(-9, 5)
                    trees.append((tx, ty, rng.uniform(0.7, 1.4)))

# ---------------------------------------------------------------- ground texture
print("drawing ground texture")
noise = nrng.normal(0, 1, (TEX // 8, TEX // 8)).astype(np.float32)
noise = np.asarray(Image.fromarray(noise).resize((TEX, TEX), Image.BICUBIC))
fine = nrng.normal(0, 1, (TEX, TEX)).astype(np.float32)
base = np.zeros((TEX, TEX, 3), np.float32)
base[..., 0] = 96 + noise * 7 + fine * 4
base[..., 1] = 128 + noise * 9 + fine * 5
base[..., 2] = 78 + noise * 6 + fine * 4
img = Image.fromarray(base.clip(0, 255).astype(np.uint8))
dr = ImageDraw.Draw(img)


def prect(x0, y0, x1, y1, fill, outline=None):
    a, b = px(x0, y1), px(x1, y0)
    dr.rectangle([a[0], a[1], b[0], b[1]], fill=fill, outline=outline)


# roads: the gaps between blocks, plus a ring
asphalt = (74, 76, 80)
for i in range(NX + 1):
    x = OFF_X + i * PITCH_X - ROAD
    prect(x, -HALF, x + ROAD, HALF, asphalt)
for j in range(NY + 1):
    y = OFF_Y + j * PITCH_Y - ROAD
    prect(-HALF, y, HALF, y + ROAD, asphalt)
for i in range(NX + 1):  # dashed center lines
    x = OFF_X + i * PITCH_X - ROAD / 2
    for y in np.arange(-HALF, HALF, 9):
        prect(x - 0.12, y, x + 0.12, y + 4, (222, 204, 120))
for j in range(NY + 1):
    y = OFF_Y + j * PITCH_Y - ROAD / 2
    for x in np.arange(-HALF, HALF, 9):
        prect(x, y - 0.12, x + 4, y + 0.12, (222, 204, 120))
for p in parks:
    x, y = p["x"], p["y"]
    if p["kind"] == "park":
        prect(x - 73, y - 40, x + 73, y + 40, (88, 142, 78))
        a, b = px(x - 30, y + 14), px(x + 30, y - 14)
        dr.ellipse([a[0], a[1], b[0], b[1]], fill=(198, 180, 140))
        prect(x + 40, y - 12, x + 60, y + 12, (214, 178, 96))  # playground sand
    elif p["kind"] == "tennis":
        prect(x - 73, y - 40, x + 73, y + 40, (92, 138, 84))
        for cx in (-36, 0, 36):
            prect(x + cx - 12, y - 18, x + cx + 12, y + 18, (58, 110, 150), outline=(240, 240, 240))
            prect(x + cx - 12, y - 0.2, x + cx + 12, y + 0.2, (240, 240, 240))
    elif p["kind"] == "pond":
        prect(x - 73, y - 40, x + 73, y + 40, (90, 140, 82))
        a, b = px(x - 55, y + 30), px(x + 55, y - 30)
        dr.ellipse([a[0], a[1], b[0], b[1]], fill=(70, 120, 150))
    else:  # parking lots around big buildings
        prect(x - 73, y - 40, x + 73, y + 40, (120, 120, 122))
        for sx in np.arange(x - 70, x + 70, 2.8):
            prect(sx, y - 38, sx + 0.15, y - 30, (230, 230, 230))
for b in buildings:
    if b["type"] == "house":
        lx, ly, lw, ld = b["lot"]
        shade = rng.randint(-8, 8)
        prect(lx - lw / 2 + 0.4, ly - ld / 2 + 0.4, lx + lw / 2 - 0.4, ly + ld / 2 - 0.4, (104 + shade, 146 + shade, 88 + shade))
        edge = ly + b["sgn"] * ld / 2
        dx = b["cx"] + 3
        prect(dx - 1.6, min(edge, b["cy"]), dx + 1.6, max(edge, b["cy"]), (176, 172, 164))  # driveway
for x, y, area in pools:
    r = math.sqrt(area) / 2
    a, c = px(x - r * 1.3, y + r * 0.8), px(x + r * 1.3, y - r * 0.8)
    dr.rounded_rectangle([a[0] - 3, a[1] - 3, c[0] + 3, c[1] + 3], radius=6, fill=(206, 200, 188))
    dr.rounded_rectangle([a[0], a[1], c[0], c[1]], radius=5, fill=(64, 164, 204))
for b in buildings:
    pts = [px(x, y) for x, y in b["poly"]]
    dr.polygon(pts, fill=b["roof"], outline=tuple(int(c * 0.7) for c in b["roof"]))
    if b["type"] == "house":
        xs, ys = [p[0] for p in b["poly"]], [p[1] for p in b["poly"]]
        a, c = px(min(xs) + 1.5, b["cy"]), px(max(xs) - 1.5, b["cy"])
        dr.line([a, c], fill=tuple(int(v * 0.8) for v in b["roof"]), width=3)
        if b.get("solar"):
            prect(b["cx"] - 3, b["cy"] - 3.5, b["cx"] + 3, b["cy"] - 0.8, (28, 40, 78), outline=(120, 130, 160))
    else:
        for k in range(4):
            ux, uy = b["cx"] + rng.uniform(-20, 20), b["cy"] + rng.uniform(-12, 12)
            prect(ux - 1.5, uy - 1.5, ux + 1.5, uy + 1.5, (188, 188, 190), outline=(90, 90, 90))
for x, y, s in trees:
    r = 3.2 * s
    a, c = px(x - r, y + r), px(x + r, y - r)
    g = rng.randint(-12, 12)
    dr.ellipse([a[0] + 3, a[1] + 3, c[0] + 3, c[1] + 3], fill=(60, 84, 56))
    dr.ellipse([a[0], a[1], c[0], c[1]], fill=(52 + g, 108 + g, 54 + g))
img = img.filter(ImageFilter.GaussianBlur(0.6))

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "mp").mkdir(parents=True)
(OUT / "photos").mkdir()
(OUT / "README.md").write_text("Synthetic neighborhood from tools/make_mock_data.py. Entirely invented, zero Sponsor Data.
")
img.save(OUT / "ground.jpg", quality=82)
bbox = [*ll(-HALF, -HALF), *ll(HALF, HALF)]
(OUT / "ground.json").write_text(json.dumps({"bounds": bbox, "width": TEX, "height": TEX}))
(OUT / "area.json").write_text(json.dumps({"city": "mock", "name": "Mockingbird Heights", "state": "CA", "center": [LAT0, LON0],
                                           "bbox": bbox, "flat": True, "mock": True}))
# gentle rolling terrain so ground following is exercised (row 0 = north edge, col 0 = west edge)
N = 65
zz = []
for r in range(N):
    for c in range(N):
        x, y = -HALF + c / (N - 1) * SIZE_M, HALF - r / (N - 1) * SIZE_M
        zz.append(round(3.0 * math.sin(x / 260) * math.cos(y / 310) + 3.0, 2))
(OUT / "terrain.json").write_text(json.dumps({"n": N, "bbox": bbox, "flat": False, "z": zz}))

# ---------------------------------------------------------------- listings
print("writing listings")
HIGHLIGHTS = ["Island kitchen", "Two car garage", "Hardwood floors", "Walk in closet", "Covered patio", "Fireplace",
              "Home office", "Vaulted ceilings", "Quartz counters", "Fenced backyard", "Corner lot", "Updated bathrooms",
              "Open floor plan", "Mature trees", "Smart thermostat", "Stainless appliances"]
SCHOOLS = ["Assigned to Larkspur Elementary, rated above average", "Walk to Finch Middle School",
           "Top rated Heron High School nearby"]
house_b = [b for b in buildings if b["type"] == "house"]
apt_b = [b for b in buildings if b["type"] == "apartments"]
rng.shuffle(house_b)
chosen = house_b[:72]
kinds = ["sale"] * 45 + ["rent"] * 12 + ["sold"] * 15
MODELS = ["mockA", "mockB", "mockC", "mockD"]
listings = []
tile_words = {"park": [p for p in parks if p["kind"] == "park"], "school": [p for p in parks if p["kind"] == "school"],
              "shopping center": [p for p in parks if p["kind"] == "shops"],
              "playground": [p for p in parks if p["kind"] == "park"],
              "tennis court": [p for p in parks if p["kind"] == "tennis"], "water": [p for p in parks if p["kind"] == "pond"]}


def nearby_for(x, y):
    out = {}
    for word, ps in tile_words.items():
        if ps:
            out[word] = round(min(math.hypot(p["x"] - x, p["y"] - y) for p in ps))
    return out


for n, (b, kind) in enumerate(zip(chosen, kinds)):
    beds = rng.choice([2, 3, 3, 3, 4, 4, 5])
    baths = max(1, beds - rng.choice([0, 1, 1, 2]))
    sqft = int(beds * rng.uniform(430, 620) // 10 * 10)
    price = int((sqft * rng.uniform(330, 520) + (60000 if b["pool"] else 0)) // 1000 * 1000)
    hl = rng.sample(HIGHLIGHTS, 5)
    says_pool = b["pool"] and rng.random() < 0.7  # sometimes the listing forgets the pool the aerial sees
    if says_pool:
        hl.insert(0, "Swimming pool")
    lon, lat = ll(b["cx"], b["cy"])
    listings.append({
        "id": f"M{1000 + n}", "kind": kind, "status": "Recently sold" if kind == "sold" else "For rent" if kind == "rent" else "For sale",
        "address": f"{b['num']} {b['street']} Lane", "city": "Mockingbird Heights", "state": "CA", "zip": "90000",
        "lat": lat, "lon": lon,
        "price": None if kind == "rent" else price, "priceLabel": "Sold price" if kind == "sold" else "Asking price",
        "rent": int(sqft * rng.uniform(1.9, 2.6) // 50 * 50) if kind == "rent" else None,
        "beds": beds, "baths": baths, "sqft": sqft, "lotAcres": round(rng.uniform(0.11, 0.32), 2),
        "yearBuilt": rng.randint(1958, 2022), "hoa": rng.choice([None, None, 45, 120]),
        "highlights": hl,
        "features": {"Kitchen": [f"{hl[1]} and plenty of storage"], "Parking": [rng.choice(["Attached two car garage", "Driveway parking for three"])],
                     "Schools": [rng.choice(SCHOOLS)]},
        "summary": f"A bright {beds} bedroom home on {b['street']} Lane with {hl[1].lower()} and {hl[2].lower()}.",
        "photos": [f"photos/house{(n + k) % 8}.jpg" for k in range(3)], "curbPhotos": [],
        "matterportIds": [MODELS[n % len(MODELS)]], "buildingId": b["id"], "listingPool": says_pool,
        "vexcel": {"poolDetected": b["pool"], "poolAreaSqft": round(b["poolArea"] * 10.76) if b["pool"] else 0,
                   "treeCoverPct": b["treePct"], "roofMaterial": b["mat"], "roofCondition": rng.choice([3, 4, 4, 5]),
                   "solar": bool(b.get("solar"))},
        "nearby": nearby_for(b["cx"], b["cy"]), "floorPlans": [],
    })
APT_NAMES = ["The Wren", "Juniper Court", "Alder Flats", "Poppy Row", "Heron Landing", "Sagebrush Lofts", "Clover Yard", "Finch Hall"]
for n, b in enumerate(apt_b[::2][:8]):
    lon, lat = ll(b["cx"], b["cy"])
    plans = []
    for name, beds, baths, sq in (("Studio", 0, 1, 480), ("1x1", 1, 1, 690), ("2x2", 2, 2, 1010), ("3x2", 3, 2, 1320)):
        lo = int(sq * rng.uniform(2.3, 2.9) // 25 * 25)
        plans.append({"name": name, "beds": beds, "baths": baths, "sqft": sq, "rentMin": lo, "rentMax": lo + rng.choice([150, 300, 450]),
                      "unitsAvailable": rng.randint(0, 6), "matterportIds": [MODELS[(n + beds) % len(MODELS)]]})
    listings.append({
        "id": f"A{2000 + n}", "kind": "apartments", "status": "Now leasing", "name": APT_NAMES[n],
        "address": f"{200 + 10 * n} {STREETS_EW[b['block'][1] % len(STREETS_EW)]} Lane", "city": "Mockingbird Heights", "state": "CA", "zip": "90000",
        "lat": lat, "lon": lon, "price": None, "priceLabel": "Rent", "rent": min(p["rentMin"] for p in plans),
        "rentMax": max(p["rentMax"] for p in plans),
        "beds": None, "baths": None, "sqft": None, "lotAcres": None, "yearBuilt": rng.randint(1998, 2023), "hoa": None,
        "highlights": ["Resort style pool", "Fitness center", "Covered parking", "Dog park"], "features": {},
        "summary": f"{APT_NAMES[n]} is an apartment community with a pool, a gym and four floor plans.",
        "photos": [f"photos/house{n % 8}.jpg"], "curbPhotos": [], "matterportIds": [MODELS[n % len(MODELS)]],
        "buildingId": b["id"], "listingPool": True,
        "vexcel": {"poolDetected": True, "poolAreaSqft": 650, "treeCoverPct": 12, "roofMaterial": "membrane", "roofCondition": 4, "solar": False},
        "nearby": nearby_for(b["cx"], b["cy"]), "floorPlans": plans, "unitsAvailable": sum(p["unitsAvailable"] for p in plans),
    })
(OUT / "listings.json").write_text(json.dumps(listings))
listing_b = {l["buildingId"] for l in listings}

feats = []
for b in buildings:
    ring = [ll(x, y) for x, y in b["poly"]]
    ring.append(ring[0])
    feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                  "properties": {"id": b["id"], "h": b["h"], "type": b["type"], "roofMaterial": b["mat"], "roofShape": b["shape"],
                                 "solar": bool(b.get("solar")), "pool": bool(b.get("pool")), "poolArea": b.get("poolArea", 0),
                                 "treePct": b.get("treePct", 0), "src": "mock"}})
(OUT / "buildings.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
(OUT / "scatter.json").write_text(json.dumps({
    "trees": [[*ll(x, y), round(s, 2)] for x, y, s in trees],
    "pools": [[*ll(x, y), a] for x, y, a in pools]}))
nearby = {w: [{"lat": ll(p["x"], p["y"])[1], "lon": ll(p["x"], p["y"])[0], "score": 1.0} for p in ps] for w, ps in tile_words.items()}
(OUT / "nearby.json").write_text(json.dumps(nearby))
commercial = []
for n, b in enumerate([b for b in buildings if b["type"] in ("shops", "school")]):
    lon, lat = ll(b["cx"], b["cy"])
    commercial.append({"id": f"C{n}", "name": ["Lark Street Market", "Finch Plaza", "Heron Corner Shops", "Larkspur Elementary", "Finch Middle School"][n % 5],
                       "type": "Retail" if b["type"] == "shops" else "School", "sqft": 54000, "tenants": rng.randint(4, 14) if b["type"] == "shops" else 1,
                       "lastSale": None, "lat": lat, "lon": lon, "buildingId": b["id"]})
(OUT / "commercial.json").write_text(json.dumps(commercial))
# invented businesses on the market, for the map (fixed numbers: the random stream is not used,
# so nothing else in the mock set changes)
business = []
for n, c in enumerate([c for c in commercial if c["type"] == "Retail"]):
    sale = n % 3 != 2
    business.append({"id": f"B{n}", "name": c["name"], "address": f"{120 + n * 40} Lark Street, Mockingbird Heights", "type": "Retail",
                     "lat": c["lat"], "lon": c["lon"], "sqft": c["sqft"], "year": 1998 + n * 7,
                     **({"kind": "bizsale", "price": [1850000, 2400000, 3100000][n % 3], "capRate": 6.1} if sale
                        else {"kind": "bizlease", "rateLow": 24, "rateHigh": 31, "availableSqft": 6200})})
(OUT / "business.json").write_text(json.dumps(business))
# no drone views in the mock neighborhood: an empty file, so the game does not ask for one that is missing
(OUT / "splats.json").write_text(json.dumps({}))

# ---------------------------------------------------------------- listing "photos": simple drawn houses
print("drawing photos and interiors")
for n in range(8):
    r2 = random.Random(n)
    im = Image.new("RGB", (700, 360), (150, 200, 236))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 230, 700, 360], fill=(110, 160, 96))
    wall = r2.choice([(232, 214, 186), (206, 190, 170), (188, 200, 204), (236, 228, 212), (214, 178, 150)])
    roof = r2.choice(ROOFS)
    d.rectangle([150, 130, 550, 260], fill=wall)
    d.polygon([(120, 135), (350, 40 + 10 * (n % 3)), (580, 135)], fill=roof)
    d.rectangle([320, 180, 380, 260], fill=(110, 70, 50))
    for wx in (190, 440):
        d.rectangle([wx, 160, wx + 70, 215], fill=(196, 226, 240), outline=(250, 250, 250), width=4)
    d.rectangle([330, 260, 370, 360], fill=(190, 186, 178))
    for tx in (60, 630):
        d.ellipse([tx - 45, 110, tx + 45, 230], fill=(60, 120, 64))
        d.rectangle([tx - 6, 220, tx + 6, 262], fill=(96, 70, 50))
    im.save(OUT / "photos" / f"house{n}.jpg", quality=80)

# ---------------------------------------------------------------- procedural interiors (cube maps)
ROOMS = [("Living room", (226, 214, 196)), ("Kitchen", (214, 224, 220)), ("Bedroom", (206, 212, 230)), ("Bathroom", (220, 232, 232)),
         ("Dining room", (232, 220, 204)), ("Office", (216, 210, 224))]
F = 512


def face_image(room, color, k, empty, theme):
    """One cube face. 0 up, 1 to 4 around the horizon, 5 down (same order as a Matterport skybox)."""
    r2 = random.Random(zlib.crc32(repr((room, k, theme)).encode()))
    if k == 0:
        im = Image.new("RGB", (F, F), (244, 242, 236))
        d = ImageDraw.Draw(im)
        d.ellipse([F / 2 - 50, F / 2 - 50, F / 2 + 50, F / 2 + 50], fill=(255, 250, 220), outline=(200, 196, 180), width=4)
        return im
    if k == 5:
        im = Image.new("RGB", (F, F), (164, 126, 92))
        d = ImageDraw.Draw(im)
        for y in range(0, F, 32):
            d.line([(0, y), (F, y)], fill=(140, 104, 74), width=2)
            for x in range((y // 32 % 2) * 60, F, 120):
                d.line([(x, y), (x, y + 32)], fill=(140, 104, 74), width=2)
        if not empty:
            d.rounded_rectangle([150, 150, 362, 362], radius=18, fill=(theme[0] // 2 + 60, theme[1] // 2 + 60, theme[2] // 2 + 70))
        return im
    arr = np.zeros((F, F, 3), np.float32)
    grad = np.linspace(1.04, 0.9, F)[:, None]
    for c in range(3):
        arr[..., c] = color[c] * grad
    im = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.rectangle([0, F - 26, F, F], fill=(238, 236, 230))  # baseboard
    if k == 1:
        d.rectangle([150, 120, 362, 330], fill=(170, 214, 240), outline=(250, 250, 250), width=10)
        d.line([(256, 120), (256, 330)], fill=(250, 250, 250), width=6)
        d.rectangle([150, 250, 362, 330], fill=(120, 170, 110))
        d.text((256, 60), room, anchor="mm", fill=(70, 70, 80), font=font(34))
    elif k == 3:
        d.rectangle([196, 150, 316, F - 26], fill=(128, 92, 66), outline=(90, 62, 44), width=6)
        d.ellipse([296, 320, 308, 332], fill=(220, 190, 90))
    elif k == 2 and not empty:
        d.rectangle([110, 130, 300, 250], fill=theme, outline=(60, 60, 60), width=5)
        d.rounded_rectangle([90, 340, 420, 470], radius=20, fill=(theme[0] // 2 + 40, theme[1] // 2 + 50, theme[2] // 2 + 60))
        d.rounded_rectangle([90, 300, 420, 370], radius=20, fill=(theme[0] // 2 + 60, theme[1] // 2 + 70, theme[2] // 2 + 80))
    elif k == 4 and not empty:
        d.rectangle([140, 220, 372, F - 26], fill=(146, 112, 84))
        for sy in (260, 330, 400):
            d.line([(140, sy), (372, sy)], fill=(100, 76, 56), width=5)
        for bx in range(150, 360, 22):
            d.rectangle([bx, 232, bx + 14, 258], fill=(r2.randint(60, 220), r2.randint(60, 200), r2.randint(60, 200)))
    return im


THEMES = [(196, 120, 96), (96, 140, 180), (120, 160, 110), (180, 150, 90)]
for mi, mid in enumerate(MODELS):
    (OUT / "mp" / mid).mkdir()
    panos, rooms = [], []
    n_rooms = 4 + mi % 2
    for ri in range(n_rooms):
        room, color = ROOMS[(ri + mi) % len(ROOMS)]
        pid = f"p{ri}"
        gx, gy = ri % 3, ri // 3
        for empty in (False, True):
            for k in range(6):
                face_image(room, color, k, empty, THEMES[mi]).save(OUT / "mp" / mid / f"{pid}{'_e' if empty else ''}_{k}.jpg", quality=78)
        panos.append({"id": pid, "label": str(ri + 1), "p": [gx * 4.5, gy * 4.5, 1.5], "q": [0, 0, 0, 1], "room": f"r{ri}",
                      "n": [], "faces": f"mp/{mid}/{pid}", "empty": f"mp/{mid}/{pid}_e"})
        rooms.append({"id": f"r{ri}", "label": room, "area": round(rng.uniform(9, 28), 1)})
    for a in panos:
        a["n"] = [b["id"] for b in panos if b is not a and math.dist(a["p"], b["p"]) < 5]
    (OUT / "mp" / f"{mid}.json").write_text(json.dumps({"id": mid, "mock": True, "showcase": False, "panos": panos, "rooms": rooms}))

total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
print(f"mock data: {len(buildings)} buildings, {len(listings)} listings, {len(trees)} trees, {len(pools)} pools, {total / 1e6:.1f} MB in {OUT}")
