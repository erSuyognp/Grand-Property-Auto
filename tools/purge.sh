#!/usr/bin/env bash
# Data agreement rule 5: delete every copy, extract, cache and derivative of Sponsor Data
# right after the event (after Sun Nov 15 4:00 PM ET).
set -u
cd "$(dirname "$0")/.."

TARGETS=(
  data
  public/data/la
  public/data/houston
  dist
  shots
  test-results
  playwright-report
  .playwright-profile
)

echo "This permanently deletes, in $(pwd):"
for t in "${TARGETS[@]}"; do [ -e "$t" ] && echo "  $t"; done
echo "(public/data/mock/ is synthetic and is kept.)"
read -r -p "Type DELETE to continue: " answer
if [ "$answer" != "DELETE" ]; then
  echo "Aborted, nothing deleted."
  exit 1
fi

for t in "${TARGETS[@]}"; do
  if [ -e "$t" ]; then rm -rf -- "$t" && echo "deleted $t"; fi
done

cat <<'EOF'

Done. Still to do by hand:
  1. Clear the browser cache and site data for http://localhost:5173 and http://localhost:8787
     (Chrome: Settings > Privacy > Delete browsing data, or DevTools > Application > Clear site data).
  2. Delete this project's Claude Code session logs: the folder for this project under
     ~/.claude/projects/  (e.g. ~/.claude/projects/D--Grand-Property-Auto/).
  3. Delete the CoStar kit zip, the Vexcel/Matterport downloads and anything in ~/Downloads from the event.
  4. Check git history holds no Sponsor Data: git log --stat --all
EOF
