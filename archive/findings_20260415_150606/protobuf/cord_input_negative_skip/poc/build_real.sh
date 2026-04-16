#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64"
OUT="$SCRIPT_DIR/poc_real"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
EXTRA_ABSL_LIBS=(
  -labsl_cord
  -labsl_cord_internal
  -labsl_cordz_functions
  -labsl_cordz_handle
  -labsl_cordz_info
  -labsl_cordz_sample_token
)

attempt() {
  echo "[*] $1"
  shift
  "$@"
}

if attempt "compile attempt 1" clang++ -arch arm64 $COMPILE_FLAGS "$SCRIPT_DIR/poc_real.cpp" $LINK_FLAGS -o "$OUT"; then
  :
elif attempt "compile attempt 2" xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SCRIPT_DIR/poc_real.cpp" $LINK_FLAGS "${EXTRA_ABSL_LIBS[@]}" -o "$OUT"; then
  :
elif attempt "compile attempt 3" xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS "$SCRIPT_DIR/poc_real.cpp" $LINK_FLAGS "${EXTRA_ABSL_LIBS[@]}" -lz -lm -lc++ -o "$OUT"; then
  :
else
  echo "build failed after retries" >&2
  exit 1
fi

codesign -s - -f "$OUT" >/dev/null 2>&1 || true
echo "[*] built $OUT"
