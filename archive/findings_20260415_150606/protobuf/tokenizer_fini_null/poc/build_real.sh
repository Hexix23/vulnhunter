#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64"
OUTPUT="$SCRIPT_DIR/poc_real"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

attempt() {
  echo "[*] $1"
  shift
  "$@"
}

cd "$SCRIPT_DIR" || exit 1

PROTOBUF_A="$BUILD_DIR/lib/libprotobuf.a"
UTF8_A="$BUILD_DIR/lib/libutf8_validity.a"
ABSL_FLAGS="-L/opt/homebrew/opt/abseil/lib -labsl_log_internal_check_op -labsl_log_internal_message -labsl_log_internal_nullguard -labsl_strings -labsl_strings_internal -labsl_str_format_internal -labsl_base -labsl_spinlock_wait -labsl_throw_delegate -labsl_raw_logging_internal -lpthread"

attempt "Attempt 1: clang++ with direct static libprotobuf.a" \
  clang++ $COMPILE_FLAGS poc_real.cpp "$PROTOBUF_A" $ABSL_FLAGS "$UTF8_A" -o "$OUTPUT" && exit 0

attempt "Attempt 2: xcrun clang++ -arch arm64" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp "$PROTOBUF_A" $ABSL_FLAGS "$UTF8_A" -o "$OUTPUT" && exit 0

attempt "Attempt 3: xcrun clang++ with common Homebrew paths" \
  xcrun clang++ -arch arm64 $COMPILE_FLAGS \
  -I/opt/homebrew/include -L/opt/homebrew/lib \
  poc_real.cpp "$PROTOBUF_A" $ABSL_FLAGS "$UTF8_A" -o "$OUTPUT" && exit 0

echo "[!] Failed to compile poc_real.cpp after retries." >&2
exit 1
