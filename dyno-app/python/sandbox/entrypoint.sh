#!/bin/bash
# Universal script runner for the Docker sandbox.
# Usage: entrypoint.sh <language> <script_path> [args...]

set -euo pipefail

LANGUAGE="$1"
SCRIPT="$2"
shift 2

case "$LANGUAGE" in
    python)
        exec python3 "$SCRIPT" "$@"
        ;;
    javascript)
        exec node "$SCRIPT" "$@"
        ;;
    typescript)
        exec npx tsx "$SCRIPT" "$@"
        ;;
    bash)
        exec bash "$SCRIPT" "$@"
        ;;
    cpp)
        g++ -std=c++17 -o /tmp/sandbox/a.out "$SCRIPT" && exec /tmp/sandbox/a.out "$@"
        ;;
    *)
        echo "Error: unsupported language '$LANGUAGE'" >&2
        exit 1
        ;;
esac
