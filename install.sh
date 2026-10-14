#!/usr/bin/env sh
# Install Sound Lab's runtime (Linux). See install.py for options, e.g. ./install.sh --hf-home ~/hf
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 install.py "$@"; fi
if command -v uv >/dev/null 2>&1; then exec uv run --no-project --python 3.12 install.py "$@"; fi
echo "Needs python3 (any 3.8+) or uv to run the installer." >&2
exit 1
