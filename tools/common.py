"""Shared helpers for the data tools: paths, .env loading, disk cache."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
CACHE = DATA / "cache"
SAMPLES = DATA / "samples"
PUBLIC_DATA = ROOT / "public" / "data"
KIT = RAW / "costar"


def load_env():
    """Read .env into os.environ (without overriding what is already set). Never prints values."""
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def cache_key(*parts):
    blob = json.dumps(parts, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:32]


class DiskCache:
    """Responses on disk, keyed by a hash of the request. JSON as .json, bytes as .bin."""

    def __init__(self, name):
        self.dir = CACHE / name
        self.dir.mkdir(parents=True, exist_ok=True)

    def get_json(self, key):
        p = self.dir / f"{key}.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
        return None

    def put_json(self, key, value):
        (self.dir / f"{key}.json").write_text(json.dumps(value), encoding="utf-8")

    def get_bytes(self, key):
        p = self.dir / f"{key}.bin"
        return p.read_bytes() if p.exists() else None

    def put_bytes(self, key, value):
        (self.dir / f"{key}.bin").write_bytes(value)


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)
