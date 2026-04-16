#!/bin/bash
set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
SRC="$ROOT/bugs/protobuf/protobuf-input-001/poc/poc_real.cpp"
OUT="$ROOT/bugs/protobuf/protobuf-input-001/poc/poc_real"
ERR="$ROOT/bugs/protobuf/protobuf-input-001/poc/compile_err.txt"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt") $BUILD_DIR/lib/libupb.a"

echo "=== Environment Detection ==="
echo "OS: $(uname -s), Arch: $(uname -m)"
echo "Rosetta: $(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)"
echo "Clang: $(which clang++ 2>/dev/null || echo 'NOT FOUND')"
echo "xcrun: $(which xcrun 2>/dev/null || echo 'NOT FOUND')"

echo "[Attempt 1] Standard compilation"
if clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" 2>"$ERR"; then
  echo "SUCCESS: Standard compilation"
  codesign -s - -f "$OUT" 2>/dev/null || true
  exit 0
fi
cat "$ERR"

echo "[Attempt 2] Add homebrew paths"
if clang++ $COMPILE_FLAGS -I/opt/homebrew/include "$SRC" $LINK_FLAGS -L/opt/homebrew/lib -o "$OUT" 2>"$ERR"; then
  echo "SUCCESS: With homebrew paths"
  codesign -s - -f "$OUT" 2>/dev/null || true
  exit 0
fi
cat "$ERR"

echo "[Attempt 3] Explicit stdlib"
if clang++ -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" 2>"$ERR"; then
  echo "SUCCESS: With explicit stdlib"
  codesign -s - -f "$OUT" 2>/dev/null || true
  exit 0
fi
cat "$ERR"

echo "[Attempt 4] Use system clang"
if xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" 2>"$ERR"; then
  echo "SUCCESS: With xcrun clang++"
  codesign -s - -f "$OUT" 2>/dev/null || true
  exit 0
fi
cat "$ERR"

echo "[Attempt 5] Minimal flags"
if clang++ -std=c++17 -I"$BUILD_DIR/include" "$SRC" "$BUILD_DIR/lib/libupb.a" -o "$OUT" 2>"$ERR"; then
  echo "SUCCESS: Minimal flags (no ASan)"
  codesign -s - -f "$OUT" 2>/dev/null || true
  exit 0
fi
cat "$ERR"

echo "FAILED: All compilation attempts failed"
exit 1
