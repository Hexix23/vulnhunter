#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../../" && pwd)"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"
SRC="$SCRIPT_DIR/impact_demo.cpp"
OUT="$SCRIPT_DIR/impact_demo"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

echo "[attempt 1] clang++ with build-agent flags"
if clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT"; then
  exit 0
fi

echo "[attempt 2] add common Homebrew include/lib paths"
if clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -I/opt/homebrew/include -L/opt/homebrew/lib -o "$OUT"; then
  exit 0
fi

echo "[attempt 3] force libc++"
if clang++ -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT"; then
  exit 0
fi

echo "[attempt 4] switch to g++"
if g++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT"; then
  exit 0
fi

echo "[attempt 5] compile minimal standalone demo without protobuf link flags"
exec clang++ -std=c++17 -g -O1 "$SRC" -o "$OUT"
