#!/bin/bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
POC_DIR="$ROOT/bugs/protobuf/upb-decoder-reserve-overflow/poc"

cd "$POC_DIR"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
EXTRA_INCLUDES="-I$ROOT/targets/protobuf"
EXTRA_LINKS="-lupb"

if xcrun clang++ -arch arm64 $COMPILE_FLAGS $EXTRA_INCLUDES poc_real.cpp $LINK_FLAGS $EXTRA_LINKS -o poc_real; then
  :
elif xcrun clang++ -arch arm64 $COMPILE_FLAGS $EXTRA_INCLUDES poc_real.cpp $LINK_FLAGS $EXTRA_LINKS -L/opt/homebrew/lib -I/opt/homebrew/include -labsl_cord -lz -o poc_real; then
  :
elif clang++ $COMPILE_FLAGS $EXTRA_INCLUDES poc_real.cpp $LINK_FLAGS $EXTRA_LINKS -L/opt/homebrew/lib -I/opt/homebrew/include -labsl_cord -lz -o poc_real; then
  :
else
  xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS $EXTRA_INCLUDES poc_real.cpp $LINK_FLAGS $EXTRA_LINKS -L/opt/homebrew/lib -I/opt/homebrew/include -labsl_cord -lz -lc++ -o poc_real
fi

codesign -s - -f poc_real 2>/dev/null || true
