#!/bin/bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT/bugs/protobuf/tokenizer_error_swallow"
POC_DIR="$BUG_DIR/poc"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"

cd "$POC_DIR"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
ABSL_ALL_LIBS="$(find /opt/homebrew/opt/abseil/lib -maxdepth 1 \( -name 'libabsl_*.dylib' -o -name 'libabsl_*.a' \) | sort | tr '\n' ' ')"

if command -v xcrun >/dev/null 2>&1; then
  if xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS $ABSL_ALL_LIBS -o poc_real; then
    codesign -s - -f poc_real 2>/dev/null || true
    exit 0
  fi
fi

if command -v clang++ >/dev/null 2>&1; then
  if clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS $ABSL_ALL_LIBS -o poc_real; then
    codesign -s - -f poc_real 2>/dev/null || true
    exit 0
  fi
fi

if command -v clang++ >/dev/null 2>&1; then
  clang++ -stdlib=libc++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    -I/opt/homebrew/include -L/opt/homebrew/lib $ABSL_ALL_LIBS -o poc_real
  codesign -s - -f poc_real 2>/dev/null || true
  exit 0
fi

echo "compilation failed" >&2
exit 1
