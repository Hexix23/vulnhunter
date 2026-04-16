#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64"
OUTPUT="$SCRIPT_DIR/poc_real"
COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

cd "$SCRIPT_DIR" || exit 1

attempt() {
  local compiler="$1"
  shift
  echo "[*] compiler: $compiler $*"
  # shellcheck disable=SC2086
  $compiler $* $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o "$OUTPUT"
}

if attempt clang++; then
  :
elif attempt xcrun clang++ -arch arm64; then
  :
elif attempt xcrun clang++ -arch arm64 -stdlib=libc++ -L/opt/homebrew/lib; then
  :
else
  echo "[!] build failed after retries" >&2
  exit 1
fi

codesign -s - -f "$OUTPUT" >/dev/null 2>&1 || true
