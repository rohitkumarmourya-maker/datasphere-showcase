#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ds_version_check='import sys; sys.exit(not ((3, 11) <= sys.version_info[:2] <= (3, 13)))'
ds_python_error='Python 3.11-3.13 is required. Install Python 3.12 from https://www.python.org/ (or set DS_PYTHON to a supported Python executable).'
if [ ! -x .venv/bin/python ]; then
  ds_python="${DS_PYTHON:-}"
  if [ -n "$ds_python" ]; then
    if ! "$ds_python" -c "$ds_version_check" 2>/dev/null; then
      echo "$ds_python_error" >&2
      exit 1
    fi
  else
    for ds_candidate in python3.12 python3.13 python3.11 python3; do
      if command -v "$ds_candidate" >/dev/null 2>&1 && "$ds_candidate" -c "$ds_version_check" 2>/dev/null; then
        ds_python="$ds_candidate"
        break
      fi
    done
    if [ -z "$ds_python" ]; then
      echo "$ds_python_error" >&2
      exit 1
    fi
  fi
  "$ds_python" -m venv .venv
fi
if ! .venv/bin/python -c "$ds_version_check"; then
  echo "Existing .venv uses an unsupported Python. Remove .venv and rerun. $ds_python_error" >&2
  exit 1
fi
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
echo "Open http://127.0.0.1:${DS_PORT:-8710}"
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "${DS_PORT:-8710}"
