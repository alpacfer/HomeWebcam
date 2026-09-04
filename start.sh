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
DEBUG_PORT="${HOMEWEBCAM_DEBUG_PORT:-9222}"
CAMERA_DEV="${HOMEWEBCAM_CAMERA_DEV:-/dev/video0}"
PROFILE_DIR="${XDG_RUNTIME_DIR:-/tmp}/homewebcam-chrome-${UID}"
BROWSER_PID=""

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

# Closing the mirror window leaves the dev server running, and the window is the
# part people close. Refusing to start then meant killing a working server to
# get a browser back, so a server that is already serving *this* app is reused.
# Something else on the port is still fatal: Vite would silently pick another
# one and the browser would open on the wrong URL.
REUSE_SERVER=""
if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  if curl -sf -o /dev/null "$URL"; then
    REUSE_SERVER=1
  else
    die "Something that is not the mirror is listening on port $PORT. Close it and try again."
  fi
fi

if [ -z "${HOMEWEBCAM_NO_BROWSER:-}" ] && command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":$DEBUG_PORT "; then
  die "The mirror is already open (Chrome control port $DEBUG_PORT is in use). Close that window first."
fi

# The C922 halves its frame rate to afford a long exposure in dim light: 30 fps
# becomes 15, at every resolution, while still reporting 30 to the browser. The
# UVC control that permits that is exposure_dynamic_framerate, and turning it
# off keeps auto-exposure working with the frame rate pinned. There is no
# MediaTrack constraint for it, so it is set here.
#
# Setting a control needs no root - only installing v4l-utils does - but it does
# not survive a replug or a reboot, so it runs on every start. See friction 0013.
if command -v v4l2-ctl >/dev/null; then
  if v4l2-ctl -d "$CAMERA_DEV" -c exposure_dynamic_framerate=0 2>/dev/null; then
    say "Pinned the camera frame rate (exposure_dynamic_framerate=0)"
  fi
elif [ ! -e "$CAMERA_DEV" ]; then
  : # No camera to configure; the mirror will report that itself.
else
  printf '\n\033[1;33m! v4l-utils is not installed, so the camera may halve its frame rate in dim light.\033[0m\n'
  printf '  Install it once with:  sudo apt install v4l-utils\n'
  printf '  Then this script pins the rate on every start. See docs/hardware.md.\n'
fi

# The camera is exclusive: a leftover browser holding it makes the mirror fail
# with "Could not start video source" and no obvious cause.
if command -v fuser >/dev/null && fuser "$CAMERA_DEV" >/dev/null 2>&1; then
  printf '\n\033[1;33m! Another program is using the webcam. The mirror may fail to start.\033[0m\n'
  fuser -v "$CAMERA_DEV" 2>&1 | tail -n +2 || true
fi

SERVER=""
if [ -n "$REUSE_SERVER" ]; then
  say "Reusing the dev server already running at $URL"
else
  say "Starting the dev server"
  npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort &
  SERVER=$!
fi

# Only tear down what this run started. Killing a server we merely borrowed
# would take the mirror down with the window.
cleanup() {
  if [ -n "$BROWSER_PID" ]; then kill "$BROWSER_PID" 2>/dev/null || true; fi
  if [ -n "$SERVER" ]; then kill "$SERVER" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

# Wait for Vite to actually accept connections before opening a window, so the
# browser never lands on a connection-refused page.
for _ in $(seq 1 100); do
  if curl -sf -o /dev/null "$URL"; then break; fi
  if [ -n "$SERVER" ]; then
    kill -0 "$SERVER" 2>/dev/null || die "The dev server exited. Scroll up for the error."
  fi
  sleep 0.2
done

# Set HOMEWEBCAM_NO_BROWSER=1 to start the server without opening a window.
# Used by the screenshot harness, which brings its own browser.
if [ -n "${HOMEWEBCAM_NO_BROWSER:-}" ]; then
  say "Server up at $URL (browser skipped)"
else
say "Opening the mirror at $URL"
# Chrome's --app window has no address bar or tabs, which is what the station
# wants, and --start-fullscreen makes that deterministic instead of depending
# on whatever bounds the profile last remembered.
if command -v google-chrome >/dev/null; then
  mkdir -p "$PROFILE_DIR"
  chmod 700 "$PROFILE_DIR"
  # Grant the camera in the profile instead of passing
  # --use-fake-ui-for-media-stream, which Chrome brands unsupported and answers
  # with a banner across the top of a deliberately wordless interface.
  node scripts/seed-camera-permission.mjs "$PROFILE_DIR" "$URL" || true
  google-chrome \
    --app="$URL" \
    --start-fullscreen \
    --autoplay-policy=no-user-gesture-required \
    --no-first-run \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$DEBUG_PORT" \
    --user-data-dir="$PROFILE_DIR" \
    >/dev/null 2>&1 &
  BROWSER_PID=$!
elif command -v xdg-open >/dev/null; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  say "Open $URL in a browser yourself."
fi
fi

cat <<EOF

  Mirror running at $URL
    D          debug camera and diagnostics
    F          final visitor camera and UI
    CDP        127.0.0.1:$DEBUG_PORT (local verification only)
    Ctrl+C     stop the server

EOF

if [ -n "$SERVER" ]; then
  wait "$SERVER"
else
  # Nothing of ours to wait on: hold the window open so Ctrl+C still reads as
  # "stop", and so closing this terminal does not look like a crash.
  say "The dev server was already running; it keeps running after this closes."
  wait "$BROWSER_PID" 2>/dev/null || true
fi
