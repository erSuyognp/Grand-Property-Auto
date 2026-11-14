"""Runs tools/sponsor/build_city.py.

The real script holds Sponsor schema and API details, so it lives in tools/sponsor/, which is
gitignored and deleted by tools/purge.sh (data agreement rule 3). If it is missing, the game
still runs on the mock data in public/data/mock/.
"""
import runpy
import sys
from pathlib import Path

script = Path(__file__).resolve().parent / "sponsor" / "build_city.py"
if not script.exists():
    sys.exit(f"{script} is not here (it is local only). Use GAME_MODE=mock.")
sys.path.insert(0, str(script.parent))
runpy.run_path(str(script), run_name="__main__")
