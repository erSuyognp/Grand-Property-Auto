"""Runs tools/sponsor/build_walk.py (walk mode data: baked base colors for every interior mesh,
2K and 4K sky boxes and a frame check for the 8 homes we demo most). Run it after
tools/build_mesh.py.

The real script holds Sponsor API details, so it lives in tools/sponsor/, which is gitignored
and deleted by tools/purge.sh (data agreement rule 3).

    python tools/build_walk.py --city houston --res4k 2
"""
import runpy
import sys
from pathlib import Path

script = Path(__file__).resolve().parent / "sponsor" / "build_walk.py"
if not script.exists():
    sys.exit(f"{script} is not here (it is local only). Use GAME_MODE=mock.")
sys.path.insert(0, str(script.parent))
runpy.run_path(str(script), run_name="__main__")
