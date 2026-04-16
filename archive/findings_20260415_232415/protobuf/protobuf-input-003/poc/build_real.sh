#!/bin/bash

set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT/bugs/protobuf/protobuf-input-003"
POC_DIR="$BUG_DIR/poc"
VALIDATION_DIR="$BUG_DIR/validation"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"

mkdir -p "$VALIDATION_DIR"

if [ ! -f "$BUILD_DIR/compile_flags.txt" ] || [ ! -f "$BUILD_DIR/link_flags.txt" ]; then
  echo "ERROR: missing prebuilt ASan flag files in $BUILD_DIR" >&2
  exit 1
fi

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
SRC="$POC_DIR/poc_real.cpp"
OUT="$POC_DIR/poc_real"
TMP_OUT="$POC_DIR/poc_real.tmp"

compile_with() {
  local label="$1"
  shift
  echo "$label" >>"$VALIDATION_DIR/compile.stdout.txt"
  printf '%s %s %s %s -o %s\n' "$1" "$*" "$COMPILE_FLAGS" "$SRC" "$TMP_OUT" \
    >"$VALIDATION_DIR/compile.command.txt"
  rm -f "$TMP_OUT"
  "$@" $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$TMP_OUT" \
    >>"$VALIDATION_DIR/compile.stdout.txt" \
    2>>"$VALIDATION_DIR/compile.stderr.txt"
}

echo -n >"$VALIDATION_DIR/compile.stdout.txt"
echo -n >"$VALIDATION_DIR/compile.stderr.txt"
if compile_with "[Attempt 1] /usr/bin/clang++ -arch arm64" /usr/bin/clang++ -arch arm64; then
  :
else
  if compile_with "[Attempt 2] xcrun clang++ -arch arm64" xcrun clang++ -arch arm64; then
    :
  else
    compile_with "[Attempt 3] xcrun clang++ -arch arm64 -stdlib=libc++" \
      xcrun clang++ -arch arm64 -stdlib=libc++ || exit 1
  fi
fi

mv "$TMP_OUT" "$OUT"
codesign -s - -f "$OUT" >/dev/null 2>&1 || true
