#!/usr/bin/env bash
# Publiceer de GEO-meter naar geo.harmsen.nl (GitHub Pages).
# - Draait tests
# - Controleert dat de working tree schoon is en je op main staat
# - Pusht naar origin/main (GitHub Pages serveert automatisch)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

LIVE_URL="https://geo.harmsen.nl"
BRANCH="main"

echo "→ Tests draaien"
node --test tests/*.test.js >/dev/null
echo "  ✓ tests groen"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "✗ Je staat op '${CURRENT_BRANCH}', publish.sh wil op '${BRANCH}'." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree is niet schoon. Commit of stash eerst:" >&2
  git status --short >&2
  exit 1
fi

if [ ! -f CNAME ]; then
  echo "✗ CNAME ontbreekt — GitHub Pages weet niet welk domein te serveren." >&2
  exit 1
fi

AHEAD="$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo "0")"
if [ "$AHEAD" = "0" ]; then
  echo "ℹ Geen commits om te pushen — origin/${BRANCH} is al up-to-date."
else
  echo "→ ${AHEAD} commit(s) pushen naar origin/${BRANCH}"
  git push origin "$BRANCH"
fi

echo ""
echo "✓ Klaar. GitHub Pages publiceert binnen ~1 min."
echo "  Live:   ${LIVE_URL}"
echo "  Status: https://github.com/hpharmsen/geo/actions"
