"""Confidentiality check over every tracked file (git ls-files).

Fails if a tracked file contains a real listing id, a real address, a 3D model id, a key
from .env, or a sponsor API hostname (allowed only in .env.example). The forbidden strings
are read from the local data, so this script itself holds none of them.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOW_HOSTS_IN = {".env.example"}
# The owner's own plan document quotes API details from the event materials. It is reported as
# a warning: review or remove it before sharing the repository with anyone.
WARN_ONLY = {"BUILD_PLAN.md"}
HOST_PATTERNS = [r"api\.vexcel\w*\.com", r"api\.matterport\.com", r"beta-app\.matterport\.com", r"cdn-\d\.matterport\.com",
                 r"images(cdn)?\.homes\.com", r"csgpimgs\.com"]


def forbidden():
    out = {}
    for city in ("houston", "la"):
        p = ROOT / "public" / "data" / city / "listings.json"
        if not p.exists():
            continue
        for l in json.loads(p.read_text()):
            out[str(l["id"]).replace("apt-", "")] = "listing id"
            if l.get("address") and len(l["address"]) > 8:
                out[l["address"]] = "address"
            if l.get("name") and len(l["name"]) > 8:
                out[l["name"]] = "community name"
            for m in l.get("matterportIds", []):
                out[m] = "model id"
        c = ROOT / "public" / "data" / city / "commercial.json"
        if c.exists():
            for x in json.loads(c.read_text()):
                if x.get("name") and len(x["name"]) > 8:
                    out[x["name"]] = "commercial name"
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip().endswith(("_KEY", "_TOKEN")) and len(v.strip()) >= 12:
                out[v.strip()] = f"secret {k.strip()}"
    return out


def main():
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    bad = forbidden()
    problems, warnings = [], []
    for f in files:
        p = ROOT / f
        if not f or not p.is_file() or p.suffix.lower() in (".jpg", ".png", ".ico", ".woff2"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for needle, kind in bad.items():
            if needle in text:
                problems.append(f"{f}: contains a real {kind}")
        if f not in ALLOW_HOSTS_IN:
            for pat in HOST_PATTERNS:
                if re.search(pat, text):
                    (warnings if f in WARN_ONLY else problems).append(f"{f}: sponsor API hostname ({pat})")
    remotes = subprocess.run(["git", "remote", "-v"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if remotes:
        problems.append("git has a remote configured: " + remotes.splitlines()[0])
    tracked_data = [f for f in files if f.startswith(("data/", "public/data/houston", "public/data/la", "shots/", "tools/sponsor", "server/sponsor"))]
    for f in tracked_data:
        problems.append(f"{f}: Sponsor Data path is tracked")
    print(f"checked {len(files)} tracked files against {len(bad)} confidential strings")
    for w in sorted(set(warnings)):
        print("  WARNING", w)
    for pr in sorted(set(problems)):
        print("  PROBLEM", pr)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
