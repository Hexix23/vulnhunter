#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

cd "$SCRIPT_DIR"

attempt_compile() {
  local compiler="$1"
  shift
  echo "[*] Trying: $compiler $*"
  # shellcheck disable=SC2086
  $compiler $@ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real
}

ABSL_EXTRA_LIBS=(
  -labsl_cord
  -labsl_cord_internal
  -labsl_cordz_info
  -labsl_cordz_functions
  -labsl_cordz_handle
  -labsl_cordz_sample_token
  -labsl_crc_cord_state
  -labsl_crc32c
  -labsl_graphcycles_internal
  -labsl_synchronization
)

attempt_compile clang++ "${ABSL_EXTRA_LIBS[@]}" && exit 0
attempt_compile xcrun clang++ -arch arm64 "${ABSL_EXTRA_LIBS[@]}" && exit 0
attempt_compile clang++ -I/opt/homebrew/include -L/opt/homebrew/lib "${ABSL_EXTRA_LIBS[@]}" && exit 0
attempt_compile xcrun clang++ -arch arm64 -I/opt/homebrew/include -L/opt/homebrew/lib "${ABSL_EXTRA_LIBS[@]}" && exit 0

echo "Compilation failed after retries." >&2
exit 1
