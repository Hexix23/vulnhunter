#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILD_DIR="$REPO_ROOT/builds/protobuf-asan-arm64"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
ABSL_DYLIBS=(/opt/homebrew/opt/abseil/lib/libabsl_*.dylib)

cd "$SCRIPT_DIR"

echo "[*] compile attempt 1"
if ! xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real; then
  echo "[*] compile attempt 2"
  if ! xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp \
    -L"$BUILD_DIR/lib" -lprotobuf "$BUILD_DIR/lib/libutf8_validity.a" \
    "${ABSL_DYLIBS[@]}" -lpthread -o poc_real; then
    echo "[*] compile attempt 3"
    xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS poc_real.cpp \
      -L"$BUILD_DIR/lib" -lprotobuf "$BUILD_DIR/lib/libutf8_validity.a" \
      "${ABSL_DYLIBS[@]}" -lpthread -lc++ -o poc_real
  fi
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
echo "[+] built $SCRIPT_DIR/poc_real"
