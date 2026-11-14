"""Runs tools/sponsor/build_mesh.py (interior meshes and extra panoramas for walk mode).

The real script holds Sponsor API details, so it lives in tools/sponsor/, which is gitignored
and deleted by tools/purge.sh (data agreement rule 3). Run it after tools/build_city.py:

    python tools/build_mesh.py --city houston
"""
import runpy
import sys
from pathlib import Path

script = Path(__file__).resolve().parent / "sponsor" / "build_mesh.py"
if not script.exists():
    sys.exit(f"{script} is not here (it is local only). Use GAME_MODE=mock.")
sys.path.insert(0, str(script.parent))
runpy.run_path(str(script), run_name="__main__")
