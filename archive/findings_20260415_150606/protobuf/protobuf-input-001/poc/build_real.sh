#!/bin/bash
set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT/bugs/protobuf/protobuf-input-001"
POC_DIR="$BUG_DIR/poc"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
OUT="$POC_DIR/poc_real"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
EXTRA_INCLUDE="-I$ROOT/targets/protobuf"
EXTRA_LIB="$BUILD_DIR/lib/libupb.a"

cd "$POC_DIR" || exit 1

attempt() {
  echo "== $1 =="
  shift
  "$@"
}

attempt "attempt 1: clang++ with archived flags" \
  clang++ $COMPILE_FLAGS $EXTRA_INCLUDE poc_real.cpp $LINK_FLAGS $EXTRA_LIB \
  -o "$OUT"
status=$?

if [ $status -ne 0 ]; then
  attempt "attempt 2: xcrun clang++ -arch arm64" \
    xcrun clang++ -arch arm64 $COMPILE_FLAGS $EXTRA_INCLUDE poc_real.cpp \
    $LINK_FLAGS $EXTRA_LIB -o "$OUT"
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt "attempt 3: add Homebrew include/lib paths" \
    clang++ $COMPILE_FLAGS $EXTRA_INCLUDE -I/opt/homebrew/include poc_real.cpp \
    $LINK_FLAGS $EXTRA_LIB -L/opt/homebrew/lib -o "$OUT"
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt "attempt 4: xcrun clang++ with Homebrew include/lib paths" \
    xcrun clang++ -arch arm64 $COMPILE_FLAGS $EXTRA_INCLUDE \
    -I/opt/homebrew/include poc_real.cpp $LINK_FLAGS $EXTRA_LIB \
    -L/opt/homebrew/lib -o "$OUT"
  status=$?
fi

if [ $status -ne 0 ]; then
  exit $status
fi

codesign -s - -f "$OUT" >/dev/null 2>&1 || true
