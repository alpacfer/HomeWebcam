#!/usr/bin/env bash
#
# Starts the HomeWebcam dev server and opens the mirror.
#
# Double-click HomeWebcam.desktop, or run ./start.sh from a terminal.
# First run installs dependencies and downloads the models; later runs skip
# straight to the server. Ctrl+C stops everything.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

URL="http://127.0.0.1:5173"
PORT=5173

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n\n' "$1" >&2; read -rp "Press Enter to close. "; exit 1; }

command -v node >/dev/null || die "Node.js is not installed. Install Node 22 or newer, then run this again."

node_major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
if [ "$node_major" -lt 22 ]; then
  die "Node $(node --version) is too old. This project needs Node 22 or newer."
fi

if [ ! -d node_modules ]; then
  say "First run: installing dependencies (a minute or so)"
  npm install --no-audit --no-fund
fi

if [ ! -f public/models/gesture_recognizer.task ]; then
  say "First run: downloading detection models (~18 MB)"
  npm run models
fi

# A stale server on the port would make Vite silently pick another one, and then
# the browser would open on the wrong URL.
if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  die "Something is already listening on port $PORT. Close it and try again."
fi

# The camera is exclusive: a leftover browser holding it makes the mirror fail
# with "Could not start video source" and no obvious cause.
if command -v fuser >/dev/null && fuser /dev/video0 >/dev/null 2>&1; then
  printf '\n\033[1;33m! Another program is using the webcam. The mirror may fail to start.\033[0m\n'
  fuser -v /dev/video0 2>&1 | tail -n +2 || true
fi

say "Starting the dev server"
npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT INT TERM

# Wait for Vite to actually accept connections before opening a window, so the
# browser never lands on a connection-refused page.
for _ in $(seq 1 100); do
  if curl -sf -o /dev/null "$URL"; then break; fi
  kill -0 "$SERVER" 2>/dev/null || die "The dev server exited. Scroll up for the error."
  sleep 0.2
done

# Set HOMEWEBCAM_NO_BROWSER=1 to start the server without opening a window.
# Used by the screenshot harness, which brings its own browser.
if [ -n "${HOMEWEBCAM_NO_BROWSER:-}" ]; then
  say "Server up at $URL (browser skipped)"
else
say "Opening the mirror at $URL"
# Chrome's --app window has no address bar or tabs, which is what the station
# wants. Grant camera access once and Chrome remembers it for this origin.
if command -v google-chrome >/dev/null; then
  google-chrome --app="$URL" --autoplay-policy=no-user-gesture-required >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  say "Open $URL in a browser yourself."
fi
fi

cat <<EOF

  Mirror running at $URL
    d          toggle the debug overlay and HUD
    Ctrl+C     stop the server

EOF

wait "$SERVER"
