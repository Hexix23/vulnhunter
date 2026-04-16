#!/bin/bash
set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
OUT_DIR="$ROOT/bugs/protobuf/protobuf-input-002/validation"
SRC="$ROOT/bugs/protobuf/protobuf-input-002/poc/poc_real.cpp"
BIN="$OUT_DIR/poc_real"
ERR="$OUT_DIR/compile_err.txt"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

mkdir -p "$OUT_DIR"

echo "[Attempt 1] clang++ with shipped flags"
if clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN" 2>"$ERR"; then
  codesign -s - -f "$BIN" >/dev/null 2>&1 || true
  exit 0
fi

echo "[Attempt 2] add Homebrew include/lib paths"
if clang++ $COMPILE_FLAGS -I/opt/homebrew/include "$SRC" $LINK_FLAGS -L/opt/homebrew/lib -o "$BIN" 2>"$ERR"; then
  codesign -s - -f "$BIN" >/dev/null 2>&1 || true
  exit 0
fi

echo "[Attempt 3] explicit libc++"
if clang++ -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN" 2>"$ERR"; then
  codesign -s - -f "$BIN" >/dev/null 2>&1 || true
  exit 0
fi

echo "[Attempt 4] xcrun clang++ arm64"
if xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN" 2>"$ERR"; then
  codesign -s - -f "$BIN" >/dev/null 2>&1 || true
  exit 0
fi

echo "All compilation attempts failed." >&2
cat "$ERR" >&2
exit 1
