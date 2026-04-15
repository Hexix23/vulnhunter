#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

cd "$(dirname "$0")"

echo "[*] Attempt 1: clang++"
if clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real; then
  codesign -s - -f poc_real >/dev/null 2>&1 || true
  exit 0
fi

echo "[*] Attempt 2: xcrun clang++ -arch arm64"
if xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    -o poc_real; then
  codesign -s - -f poc_real >/dev/null 2>&1 || true
  exit 0
fi

echo "[*] Attempt 3: xcrun clang++ with common fallback deps"
xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
  -I/opt/homebrew/include -L/opt/homebrew/lib \
  /opt/homebrew/opt/abseil/lib/libabsl*.dylib -lz -lc++ -lm -o poc_real
codesign -s - -f poc_real >/dev/null 2>&1 || true
