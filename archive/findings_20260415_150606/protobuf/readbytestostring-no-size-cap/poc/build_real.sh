#!/bin/bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
POC_DIR="$ROOT/bugs/protobuf/readbytestostring-no-size-cap/poc"

cd "$POC_DIR"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
shopt -s nullglob
ABSL_ALL_LIBS=(/opt/homebrew/opt/abseil/lib/libabsl_*.dylib)

if xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real; then
  :
elif xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
  -L/opt/homebrew/lib -labsl_cord -lz -lc++ -lm -o poc_real; then
  :
elif xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS poc_real.cpp \
  $LINK_FLAGS -L/opt/homebrew/lib -labsl_cord -lz -lc++ -lm -o poc_real; then
  :
elif xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
  "${ABSL_ALL_LIBS[@]}" -lz -lc++ -lm -o poc_real; then
  :
else
  c++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS "${ABSL_ALL_LIBS[@]}" \
    -lz -lc++ -lm -o poc_real
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
