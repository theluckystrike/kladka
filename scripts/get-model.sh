#!/bin/sh
# Download the model once and verify its checksum. After this, no network is needed.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
FILE="EuroLLM-9B-Instruct-2512.Q4_K_M.gguf"
URL="https://huggingface.co/mradermacher/EuroLLM-9B-Instruct-2512-GGUF/resolve/main/$FILE"
SHA256="fe9b50d4ba67eb0131f1ceeaab2e56ea8fb6b2bbc37391d3219c791c3b140a28"
mkdir -p "$DIR"
if [ ! -f "$DIR/$FILE" ]; then
  echo "Downloading $FILE (5.6 GB) to $DIR"
  curl -L --fail -C - -o "$DIR/$FILE.part" "$URL"
  mv "$DIR/$FILE.part" "$DIR/$FILE"
fi
echo "Checking sha256"
echo "$SHA256  $DIR/$FILE" | shasum -a 256 -c -
