#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILD_DIR="$REPO_ROOT/builds/protobuf-asan-arm64"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
PKGCONFIG_ABSL_LIBS="$(pkg-config --libs --static \
  absl_log absl_cord absl_statusor absl_flat_hash_map absl_flat_hash_set \
  absl_raw_hash_set absl_hashtable_control_bytes absl_container_common \
  absl_hash absl_synchronization absl_time absl_strings absl_str_format \
  absl_status)"

cd "$SCRIPT_DIR"

if ! xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    $PKGCONFIG_ABSL_LIBS -lz -lc++ -lm -o poc_real; then
  clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    $PKGCONFIG_ABSL_LIBS -lz -lc++ -lm -o poc_real
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
