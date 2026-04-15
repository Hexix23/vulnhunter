#!/bin/bash
set -u

ROOT_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT_DIR/bugs/protobuf/parse_string_oom"
POC_DIR="$BUG_DIR/poc"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"

cd "$POC_DIR" || exit 1

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

attempt_compile() {
  echo "[*] $*"
  "$@"
}

attempt_compile clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real
status=$?

if [ $status -ne 0 ]; then
  attempt_compile clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -I/opt/homebrew/include -L/opt/homebrew/lib -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt_compile xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -I/opt/homebrew/include -L/opt/homebrew/lib -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt_compile xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    -L/opt/homebrew/lib -I/opt/homebrew/include \
    -labsl_cord -labsl_cord_internal -labsl_cordz_functions -labsl_cordz_handle \
    -labsl_cordz_info -labsl_hash -labsl_hashtablez_sampler -labsl_raw_hash_set \
    -labsl_status -labsl_statusor -labsl_synchronization -labsl_time \
    -labsl_time_zone -labsl_log_entry -labsl_log_globals -labsl_log_initialize \
    -labsl_log_internal_conditions -labsl_log_internal_format \
    -labsl_log_internal_globals -labsl_log_internal_nullguard -labsl_log_sink \
    -labsl_log_severity -labsl_vlog_config_internal -labsl_kernel_timeout_internal \
    -labsl_crc_cord_state -labsl_crc32c -labsl_crc_internal -labsl_crc_cpu_detect \
    -labsl_city -labsl_int128 -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt_compile xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS \
    -L/opt/homebrew/lib -I/opt/homebrew/include \
    -labsl_cord -labsl_cord_internal -labsl_cordz_functions -labsl_cordz_handle \
    -labsl_cordz_info -labsl_hash -labsl_hashtablez_sampler -labsl_raw_hash_set \
    -labsl_status -labsl_statusor -labsl_synchronization -labsl_time \
    -labsl_time_zone -labsl_log_entry -labsl_log_globals -labsl_log_initialize \
    -labsl_log_internal_conditions -labsl_log_internal_format \
    -labsl_log_internal_globals -labsl_log_internal_nullguard -labsl_log_sink \
    -labsl_log_severity -labsl_vlog_config_internal -labsl_kernel_timeout_internal \
    -labsl_crc_cord_state -labsl_crc32c -labsl_crc_internal -labsl_crc_cpu_detect \
    -labsl_city -labsl_int128 -lc++ -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  exit $status
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
