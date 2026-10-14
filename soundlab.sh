#!/usr/bin/env sh
# Sound Lab (Linux). ./soundlab.sh --help
DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$DIR/runtime/venv/bin/python"
[ -x "$PY" ] || { echo "Not installed yet: run ./install.sh" >&2; exit 1; }
PYTHONPATH="$DIR${PYTHONPATH:+:$PYTHONPATH}" exec "$PY" -m soundlab "$@"
