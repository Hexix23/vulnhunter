#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../../" && pwd)"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"
SRC="$SCRIPT_DIR/impact_demo.cpp"
OUT="$SCRIPT_DIR/impact_demo"
ERR="$SCRIPT_DIR/impact_build_errors.log"

: > "$ERR"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
LIBUPB_ONLY="-L$BUILD_DIR/lib -lupb"

attempt() {
  local label="$1"
  shift
  echo "[$label]" | tee -a "$ERR"
  if "$@" 2>>"$ERR"; then
    echo "SUCCESS: $label"
    return 0
  fi
  tail -n 40 "$ERR"
  return 1
}

attempt "Attempt 1: native Apple clang++ with bundle flags" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" && exit 0

attempt "Attempt 2: native Apple clang++ + Homebrew paths" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS -I/opt/homebrew/include "$SRC" $LINK_FLAGS \
  -L/opt/homebrew/lib -o "$OUT" && exit 0

attempt "Attempt 3: native Apple clang++ + explicit libc++" \
  xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" && exit 0

attempt "Attempt 4: native Apple clang++ + libupb only" \
  xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined -g -O1 \
  -I"$BUILD_DIR/include" "$SRC" $LIBUPB_ONLY -o "$OUT" && exit 0

attempt "Attempt 5: Homebrew clang++ + libupb only" \
  clang++ -std=c++17 -fsanitize=address,undefined -g -O1 \
  -I"$BUILD_DIR/include" "$SRC" $LIBUPB_ONLY -o "$OUT" && exit 0

echo "FAILED: all build attempts failed" >&2
exit 1
