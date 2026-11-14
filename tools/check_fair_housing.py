"""Fair housing wording check: looks for the words CLAUDE.md bans in everything the player can
read or hear (interface text, Maya's prompt, her scripted lines, mission stories).

    python tools/check_fair_housing.py

Lines that only *detect* such words in what the player says, or that state the rule itself,
are listed as allowed. Anything else fails the check.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANNED = [r"\bsafe\b", r"\bunsafe\b", r"good neighbou?rhood", r"bad area", r"\bexclusive\b", r"family[- ]friendly", r"\brich\b", r"\bpoor\b", r"up[- ]and[- ]coming", r"right kind of people",
          r"\brace\b", r"\bethnic", r"\breligio", r"national origin", r"\bdisabilit"]
# where a banned word is expected: the rule text itself, and patterns that recognize the
# player's question so Maya can decline it
ALLOWED = [
    ("server/maya.js", r"Fair housing rules|^5\. Never show|^6\. Income|^8\. Schools|whether it is \"safe\"|FAIR_HOUSING"),
    ("src/mayaScript.js", r"PEOPLE_RE|safer from|/safe\|crime|safe\|crime\|danger"),
    ("tools/maya_fairness.mjs", r"."),
]
files = [p for d in ("src", "server") for p in (ROOT / d).rglob("*") if p.suffix in (".js", ".html", ".css") and "sponsor" not in p.parts] + [ROOT / "index.html"]
bad = allowed = 0
for p in sorted(files):
    rel = p.relative_to(ROOT).as_posix()
    for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        low = line.lower()
        hit = next((b for b in BANNED if re.search(b, low)), None)
        if not hit:
            continue
        # code words that only look like a match
        if re.search(r"safe-area|racecondition|\brace\(|promise\.race|safezone|setfromspherical|\.race\b", low.replace(" ", "")):
            continue
        if any(rel == f and re.search(pat, line) for f, pat in ALLOWED):
            allowed += 1
            continue
        bad += 1
        print(f"FAIL {rel}:{n}: {line.strip()[:150]}")
print(f"\n{bad} line(s) to fix, {allowed} allowed (the rule text and the patterns that recognize the player's question).")
sys.exit(1 if bad else 0)
