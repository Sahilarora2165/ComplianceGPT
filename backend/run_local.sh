#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Missing $VENV_DIR. Run backend/bootstrap_venv.sh first."
  exit 1
fi

cd "$ROOT_DIR/backend"
exec "$VENV_DIR/bin/python" -m uvicorn app:app --reload --port 8000
