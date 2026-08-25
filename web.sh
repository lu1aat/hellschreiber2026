#!/usr/bin/env bash
#
# Serve the built application with PHP's built-in web server.
#
# PHP is only a static file server here — it cannot transform TypeScript, so
# this script builds the bundle first and serves the resulting dist/ directory.
# There is no PHP application code and no backend; see CLAUDE.md.
#
# Usage:
#   ./web.sh                      # build if needed, serve on http://localhost:8080
#   ./web.sh -p 9000              # different port
#   ./web.sh -H 0.0.0.0           # expose on the LAN (see the warning below)
#   ./web.sh -b                   # force a rebuild first
#   ./web.sh -n                   # skip the build, serve dist/ as it stands

set -euo pipefail

PORT=8080
HOST=localhost
FORCE_BUILD=0
SKIP_BUILD=0
PORT_EXPLICIT=0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"
ROUTER="$ROOT/router.php"

usage() {
  sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while getopts ":p:H:bnh" opt; do
  case "$opt" in
    p) PORT="$OPTARG"; PORT_EXPLICIT=1 ;;
    H) HOST="$OPTARG" ;;
    b) FORCE_BUILD=1 ;;
    n) SKIP_BUILD=1 ;;
    h) usage ;;
    \?) echo "Unknown option: -$OPTARG" >&2; exit 2 ;;
    :) echo "Option -$OPTARG requires an argument" >&2; exit 2 ;;
  esac
done

if ! command -v php >/dev/null 2>&1; then
  echo "error: php not found on PATH." >&2
  echo "       Install PHP, or serve dist/ with any other static file server" >&2
  echo "       (npm run preview, python3 -m http.server, nginx, ...)." >&2
  exit 1
fi

# --- Build ------------------------------------------------------------------

if [ "$SKIP_BUILD" -eq 1 ]; then
  if [ ! -f "$DIST/index.html" ]; then
    echo "error: -n given but $DIST/index.html does not exist. Build first." >&2
    exit 1
  fi
elif [ "$FORCE_BUILD" -eq 1 ] || [ ! -f "$DIST/index.html" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "error: npm not found, and dist/ has not been built." >&2
    exit 1
  fi
  echo "Building..."
  (cd "$ROOT" && npm run build)
  echo
fi

# --- Secure context warning -------------------------------------------------
#
# getUserMedia only works in a secure context. localhost counts as secure; a
# plain-http LAN address does not, and the microphone will silently never start.
# This is the most common "the decoder is broken" report, so warn loudly.

if [ "$HOST" != "localhost" ] && [ "$HOST" != "127.0.0.1" ]; then
  cat >&2 <<'WARN'
WARNING: serving on a non-localhost address over plain HTTP.

  Browsers block microphone access outside a secure context, so RECEIVE WILL
  NOT WORK when the page is opened via a LAN IP over http://. Transmit still
  works, since playback needs no permission.

  To decode on another machine, put this behind https (a reverse proxy with a
  certificate, or a tunnel), or open the page on the host itself.

WARN
fi

# --- Serve ------------------------------------------------------------------

# Check the port before printing the banner. php -S reports "Address already in
# use" only after this script has claimed success, which reads as though the
# server started when it did not.
port_in_use() {
  php -r '
    $host = $argv[1] === "0.0.0.0" ? "127.0.0.1" : $argv[1];
    $sock = @fsockopen($host, (int) $argv[2], $errno, $errstr, 0.5);
    if ($sock) { fclose($sock); exit(0); }
    exit(1);
  ' "$HOST" "$1" 2>/dev/null
}

if port_in_use "$PORT"; then
  if [ "$PORT_EXPLICIT" -eq 1 ]; then
    # An explicit -p is a request, not a suggestion: fail rather than silently
    # serving somewhere the operator is not looking.
    echo "error: something is already listening on $HOST:$PORT." >&2
    exit 1
  fi

  # 8080 is a popular port and often taken by something unrelated. Walk forward
  # to the first free one rather than making the operator guess.
  original=$PORT
  for _ in $(seq 1 20); do
    PORT=$((PORT + 1))
    port_in_use "$PORT" || break
  done

  if port_in_use "$PORT"; then
    echo "error: no free port found between $original and $PORT." >&2
    echo "       Specify one explicitly with -p." >&2
    exit 1
  fi
  echo "note: port $original is in use; serving on $PORT instead." >&2
  echo
fi

echo "hellschreiber2026"
echo "  root:  $DIST"
echo "  url:   http://$HOST:$PORT/"
echo
echo "Ctrl-C to stop."
echo

exec php -S "$HOST:$PORT" -t "$DIST" "$ROUTER"
