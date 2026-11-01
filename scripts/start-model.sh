#!/bin/sh
# Start llama-server on 127.0.0.1 only. It never listens on the network.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
FILE="${KLADKA_MODEL:-$DIR/EuroLLM-9B-Instruct-2512.Q4_K_M.gguf}"
PORT="${KLADKA_LLM_PORT:-8080}"
exec llama-server -m "$FILE" --host 127.0.0.1 --port "$PORT" -c 8192 -np 1 -ngl 99 --no-jinja --no-webui
