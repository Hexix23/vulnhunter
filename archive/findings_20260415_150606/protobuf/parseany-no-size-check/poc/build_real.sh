#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64"
COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
OUT="$SCRIPT_DIR/poc_real"
SRC="$SCRIPT_DIR/poc_real.cpp"

attempt() {
  echo "[*] $1"
  shift
  "$@"
}

attempt "Attempt 1: provided flags" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS -o "$OUT" && exit 0

attempt "Attempt 2: add common Homebrew include/lib roots" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS \
    -I/opt/homebrew/include -L/opt/homebrew/lib -o "$OUT" && exit 0

attempt "Attempt 3: add libc++, zlib, CoreFoundation" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" $LINK_FLAGS \
    -I/opt/homebrew/include -L/opt/homebrew/lib -lc++ -lz -framework CoreFoundation \
    -o "$OUT" && exit 0

ABSL_ALL_DYLIBS="$(printf '%s ' /opt/homebrew/opt/abseil/lib/libabsl*.dylib)"
attempt "Attempt 4: link full Homebrew Abseil dylib set" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SRC" \
    -L/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib \
    /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib/libprotobuf.a \
    /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib/libutf8_validity.a \
    $ABSL_ALL_DYLIBS -lpthread -lc++ -lz -framework CoreFoundation -o "$OUT" && exit 0

echo "[!] build failed after 4 attempts" >&2
exit 1
