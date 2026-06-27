#!/usr/bin/env bash
# Start de GEO-meter lokaal: backend (Django in ~/Sites/harmsen.nl) + frontend (static).
set -euo pipefail

GEO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$HOME/Sites/harmsen.nl"

# Backend-poort komt uit harmsen.nl/.env (PORT=...). Fallback: 8080.
BACKEND_PORT="$(grep -E '^PORT=' "${BACKEND_DIR}/.env" 2>/dev/null | tail -n1 | cut -d= -f2 | tr -d '\r' || true)"
BACKEND_PORT="${BACKEND_PORT:-8080}"

FRONTEND_PORT=5173
FRONTEND_URL="http://localhost:${FRONTEND_PORT}/?backend=http://localhost:${BACKEND_PORT}/api/geo"

backend_listening() {
  lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1
}

if backend_listening; then
  echo "✓ Backend draait al op http://localhost:${BACKEND_PORT}"
else
  if [ ! -x "${BACKEND_DIR}/runlocal.sh" ]; then
    echo "✗ Backend-script niet gevonden: ${BACKEND_DIR}/runlocal.sh" >&2
    exit 1
  fi
  echo "→ Backend starten in een nieuw Terminal-venster (${BACKEND_DIR})"
  osascript <<EOF
tell application "Terminal"
  do script "cd ${BACKEND_DIR} && ./runlocal.sh"
  activate
end tell
EOF
  printf "  wachten tot backend luistert op poort %s" "$BACKEND_PORT"
  for _ in $(seq 1 60); do
    if backend_listening; then
      printf " ✓\n"
      break
    fi
    printf "."
    sleep 1
  done
  if ! backend_listening; then
    printf "\n"
    echo "✗ Backend kwam niet op binnen 60s. Check het nieuwe Terminal-venster voor foutmeldingen." >&2
    exit 1
  fi
fi

echo ""
echo "→ Frontend serveren vanuit ${GEO_DIR} op poort ${FRONTEND_PORT}"
echo ""
echo "  👉 Open in browser: ${FRONTEND_URL}"
echo "     (Stop met Ctrl+C)"
echo ""

(sleep 1 && open "${FRONTEND_URL}") &

cd "$GEO_DIR"
exec python3 -m http.server "$FRONTEND_PORT"
