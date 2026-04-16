#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILD_DIR="$REPO_DIR/builds/protobuf-asan-arm64"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
EXTRA_LIBS=(
  "$BUILD_DIR/lib/libupb.a"
  "$BUILD_DIR/lib/libutf8_range.a"
)

EXTRA_INCLUDES=(
  -I"$REPO_DIR/targets/protobuf"
  -I"$REPO_DIR/targets/protobuf/upb/reflection/cmake"
)

attempt_compile() {
  echo "compiling with: $*"
  "$@"
}

cd "$SCRIPT_DIR"

if ! attempt_compile xcrun clang++ -arch arm64 $COMPILE_FLAGS "${EXTRA_INCLUDES[@]}" \
  poc_real.cpp $LINK_FLAGS "${EXTRA_LIBS[@]}" -o poc_real; then
  if ! attempt_compile xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS \
    "${EXTRA_INCLUDES[@]}" poc_real.cpp $LINK_FLAGS "${EXTRA_LIBS[@]}" \
    -lc++ -lm -lpthread -o poc_real; then
    attempt_compile clang++ -arch arm64 $COMPILE_FLAGS "${EXTRA_INCLUDES[@]}" \
      poc_real.cpp $LINK_FLAGS "${EXTRA_LIBS[@]}" -o poc_real
  fi
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
