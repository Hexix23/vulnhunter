#!/bin/bash
set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
OUT_DIR="$ROOT/bugs/protobuf/protobuf-input-004/validation"
SRC="$OUT_DIR/impact_demo.cpp"
BIN="$OUT_DIR/impact_demo"
ERR="$OUT_DIR/impact_compile_err.txt"

mkdir -p "$OUT_DIR"
: > "$ERR"

if [ ! -f "$BUILD_DIR/compile_flags.txt" ] || [ ! -f "$BUILD_DIR/link_flags.txt" ]; then
  echo "missing prebuilt flag files in $BUILD_DIR" | tee -a "$ERR"
  exit 1
fi

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

attempt_compile() {
  local label="$1"
  shift
  echo "[*] $label" | tee -a "$ERR"
  if "$@" >>"$ERR" 2>&1; then
    return 0
  fi
  echo "[!] failed: $label" | tee -a "$ERR"
  return 1
}

if attempt_compile "attempt 1: xcrun clang++ with bundled flags" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN"; then
  :
elif attempt_compile "attempt 2: xcrun clang++ with homebrew include/lib fallbacks" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS \
    -I/opt/homebrew/include -L/opt/homebrew/lib -o "$BIN"; then
  :
elif attempt_compile "attempt 3: xcrun clang++ with explicit libc++" \
  xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN"; then
  :
elif attempt_compile "attempt 4: homebrew clang++ with bundled flags" \
  clang++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$BIN"; then
  :
else
  exit 1
fi

codesign -s - -f "$BIN" >/dev/null 2>&1 || true
echo "[+] built $BIN" | tee -a "$ERR"
