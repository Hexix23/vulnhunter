#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"
POC_SRC="$SCRIPT_DIR/poc_real.cpp"
POC_BIN="$SCRIPT_DIR/poc_real"
LOG_FILE="$SCRIPT_DIR/build_real.log"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

run_build() {
  local compiler="$1"
  shift
  echo "compiler: $compiler $*" | tee -a "$LOG_FILE"
  "$compiler" -arch arm64 $COMPILE_FLAGS "$POC_SRC" $LINK_FLAGS "$@" -o "$POC_BIN" \
    >>"$LOG_FILE" 2>&1
}

if run_build /opt/homebrew/opt/llvm/bin/clang++; then
  :
elif run_build /usr/bin/clang++ -labsl_cord -labsl_cord_internal -labsl_cordz_info -labsl_cordz_functions -labsl_cordz_handle -labsl_cordz_sample_token -labsl_crc32c -labsl_crc_cord_state -labsl_crc_cpu_detect -labsl_crc_internal -labsl_city -labsl_hash -labsl_raw_hash_set -labsl_strings -labsl_strings_internal -labsl_base; then
  :
elif run_build /usr/bin/clang++ -stdlib=libc++ -labsl_cord -labsl_cord_internal -labsl_cordz_info -labsl_cordz_functions -labsl_cordz_handle -labsl_cordz_sample_token -labsl_crc32c -labsl_crc_cord_state -labsl_crc_cpu_detect -labsl_crc_internal -labsl_city -labsl_hash -labsl_raw_hash_set -labsl_strings -labsl_strings_internal -labsl_base; then
  :
else
  echo "build failed after retries" | tee -a "$LOG_FILE"
  exit 1
fi

codesign -s - -f "$POC_BIN" >/dev/null 2>&1 || true
echo "built: $POC_BIN" | tee -a "$LOG_FILE"
