#!/usr/bin/env sh
# SiteWatch - start the local server and open the dashboard (macOS / Linux)
# Usage: ./start.sh        (first time: chmod +x start.sh)
cd "$(dirname "$0")" || exit 1

PY=""
for c in python3 python; do                       # first one that really runs Python 3
  if "$c" -c "import sys; sys.exit(sys.version_info < (3, 10))" >/dev/null 2>&1; then PY=$c; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10+ not found. Install it: macOS 'brew install python', Ubuntu 'sudo apt install python3 python3-pip'"
  exit 1
fi

URL="http://127.0.0.1:${SITEWATCH_PORT:-8790}"
( sleep 2
  if command -v open >/dev/null 2>&1; then open "$URL"            # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1   # Linux desktop
  else echo "Open $URL in your browser"; fi ) &

exec "$PY" server.py
