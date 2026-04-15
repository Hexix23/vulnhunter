#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
PKG_LIBS="$(pkg-config --libs protobuf | sed -E \
  's@-L[^ ]+/protobuf/[^ ]+@@g; s@-lprotobuf@@g; s@-lutf8_validity@@g; s@-lutf8_range@@g')"

cd "$SCRIPT_DIR"

if command -v xcrun >/dev/null 2>&1; then
  CXX=(xcrun clang++ -arch arm64)
else
  CXX=(clang++)
fi

if ! "${CXX[@]}" $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real; then
  "${CXX[@]}" $COMPILE_FLAGS poc_real.cpp \
    "$BUILD_DIR/lib/libprotobuf.a" \
    "$BUILD_DIR/lib/libutf8_validity.a" \
    "$BUILD_DIR/lib/libutf8_range.a" \
    $PKG_LIBS \
    -I/opt/homebrew/include -L/opt/homebrew/lib -lpthread -o poc_real
fi
codesign -s - -f poc_real >/dev/null 2>&1 || true
