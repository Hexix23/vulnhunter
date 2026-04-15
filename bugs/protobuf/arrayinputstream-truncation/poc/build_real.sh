#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILD_DIR="$REPO_ROOT/builds/protobuf-asan-arm64"

cd "$SCRIPT_DIR"

if [[ ! -f "$BUILD_DIR/compile_flags.txt" || ! -f "$BUILD_DIR/link_flags.txt" ]]; then
  echo "missing prebuilt ASan flags in $BUILD_DIR" >&2
  exit 1
fi

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
EXTRA_LIBS="-labsl_cord -labsl_cord_internal -labsl_cordz_info -labsl_cordz_handle -labsl_cordz_functions -labsl_cordz_sample_token"

if clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real; then
  :
elif xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS $EXTRA_LIBS -o poc_real; then
  :
else
  xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    -L/opt/homebrew/lib $EXTRA_LIBS -lc++ -lm -o poc_real
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
