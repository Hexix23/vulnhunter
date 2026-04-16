#!/bin/bash
set -u

ROOT_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT_DIR/bugs/protobuf/protobuf-msgset-oversized-payload-buffer"
POC_DIR="$BUG_DIR/poc"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"
SRC="$POC_DIR/poc_real.cpp"
OUT="$POC_DIR/poc_real"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

cd "$POC_DIR" || exit 1

echo "[Attempt 1] clang++ with provided flags"
if clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" >build.stdout 2>build.stderr; then
  echo "SUCCESS"
elif {
  echo "[Attempt 2] clang++ with homebrew include/lib paths"
  clang++ $COMPILE_FLAGS -I/opt/homebrew/include "$SRC" $LINK_FLAGS -L/opt/homebrew/lib -o "$OUT" >build.stdout 2>build.stderr
}; then
  echo "SUCCESS"
elif {
  echo "[Attempt 3] clang++ with explicit libc++"
  clang++ -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" >build.stdout 2>build.stderr
}; then
  echo "SUCCESS"
elif {
  echo "[Attempt 4] xcrun clang++"
  xcrun clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" >build.stdout 2>build.stderr
}; then
  echo "SUCCESS"
else
  cat build.stderr
  exit 1
fi

codesign -s - -f "$OUT" >/dev/null 2>&1 || true
file "$OUT"
