#!/bin/bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
POC_DIR="$ROOT/bugs/protobuf/cord_output_backup_overreach/poc"

cd "$POC_DIR"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

if command -v xcrun >/dev/null 2>&1; then
  CXX=(xcrun clang++ -arch arm64)
else
  CXX=(clang++)
fi

set +e
"${CXX[@]}" $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real
status=$?
if [ "$status" -ne 0 ]; then
  "${CXX[@]}" $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    -L/opt/homebrew/opt/abseil/lib -Wl,-rpath,/opt/homebrew/opt/abseil/lib \
    -labsl_cord -labsl_cord_internal -labsl_cordz_info -o poc_real
  status=$?
fi
set -e
if [ "$status" -ne 0 ]; then
  exit "$status"
fi
codesign -s - -f poc_real >/dev/null 2>&1 || true
