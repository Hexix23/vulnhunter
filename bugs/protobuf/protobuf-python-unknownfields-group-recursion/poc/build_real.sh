#!/bin/bash
set -u

ROOT_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT_DIR/bugs/protobuf/protobuf-python-unknownfields-group-recursion"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"
OUT_DIR="$BUG_DIR/validation"
SRC="$BUG_DIR/poc/poc_real.cpp"
BIN="$OUT_DIR/poc_real"

mkdir -p "$OUT_DIR"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

{
  echo "=== Environment Detection ==="
  uname -a
  echo
  echo "=== Attempt 1: clang++ as-is ==="
  clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN"
} >"$OUT_DIR/build_output.txt" 2>&1

if [ $? -eq 0 ]; then
  exit 0
fi

{
  echo
  echo "=== Attempt 2: clang++ with Homebrew paths ==="
  clang++ $COMPILE_FLAGS -I/opt/homebrew/include "$SRC" $LINK_FLAGS -L/opt/homebrew/lib -o "$BIN"
} >>"$OUT_DIR/build_output.txt" 2>&1

if [ $? -eq 0 ]; then
  exit 0
fi

{
  echo
  echo "=== Attempt 3: clang++ with explicit libc++ ==="
  clang++ -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN"
} >>"$OUT_DIR/build_output.txt" 2>&1

if [ $? -eq 0 ]; then
  exit 0
fi

{
  echo
  echo "=== Attempt 4: xcrun clang++ ==="
  xcrun clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN"
} >>"$OUT_DIR/build_output.txt" 2>&1

exit 1
