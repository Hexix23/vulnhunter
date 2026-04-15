#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILD_DIR="$ROOT_DIR/builds/protobuf-asan-arm64"
OUTPUT="$SCRIPT_DIR/poc_real"

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
EXTRA_ABSL_LIBS="
  -labsl_die_if_null
  -labsl_log_initialize
  -labsl_statusor
  -labsl_log_internal_check_op
  -labsl_log_internal_conditions
  -labsl_log_internal_message
  -labsl_log_internal_nullguard
  -labsl_examine_stack
  -labsl_log_internal_format
  -labsl_log_internal_structured_proto
  -labsl_log_internal_log_sink_set
  -labsl_log_sink
  -labsl_log_entry
  -labsl_log_internal_proto
  -labsl_flags_internal
  -labsl_flags_marshalling
  -labsl_flags_reflection
  -labsl_flags_config
  -labsl_flags_program_name
  -labsl_flags_private_handle_accessor
  -labsl_flags_commandlineflag
  -labsl_flags_commandlineflag_internal
  -labsl_log_internal_globals
  -labsl_log_globals
  -labsl_vlog_config_internal
  -labsl_log_internal_fnmatch
  -labsl_raw_hash_set
  -labsl_hashtablez_sampler
  -labsl_random_distributions
  -labsl_random_seed_sequences
  -labsl_random_internal_entropy_pool
  -labsl_random_internal_randen
  -labsl_random_internal_randen_hwaes
  -labsl_random_internal_randen_hwaes_impl
  -labsl_random_internal_randen_slow
  -labsl_random_internal_platform
  -labsl_random_internal_seed_material
  -labsl_random_seed_gen_exception
  -labsl_status
  -labsl_cord
  -labsl_cordz_info
  -labsl_cord_internal
  -labsl_cordz_functions
  -labsl_exponential_biased
  -labsl_cordz_handle
  -labsl_crc_cord_state
  -labsl_crc32c
  -labsl_crc_internal
  -labsl_crc_cpu_detect
  -labsl_leak_check
  -labsl_strerror
  -labsl_str_format_internal
  -labsl_synchronization
  -labsl_stacktrace
  -labsl_borrowed_fixup_buffer
  -labsl_hash
  -labsl_city
  -labsl_symbolize
  -labsl_debugging_internal
  -labsl_demangle_internal
  -labsl_demangle_rust
  -labsl_decode_rust_punycode
  -labsl_utf8_for_code_point
  -labsl_graphcycles_internal
  -labsl_kernel_timeout_internal
  -labsl_malloc_internal
  -labsl_tracing_internal
  -labsl_time
  -labsl_strings
  -labsl_strings_internal
  -labsl_throw_delegate
  -labsl_int128
  -labsl_base
  -labsl_raw_logging_internal
  -labsl_log_severity
  -labsl_spinlock_wait
  -labsl_civil_time
  -labsl_time_zone
"

attempt() {
  echo "[*] $*"
  "$@"
}

if attempt clang++ $COMPILE_FLAGS "$SCRIPT_DIR/poc_real.cpp" $LINK_FLAGS -o "$OUTPUT"; then
  :
elif attempt xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SCRIPT_DIR/poc_real.cpp" $LINK_FLAGS -o "$OUTPUT"; then
  :
elif attempt xcrun clang++ -arch arm64 $COMPILE_FLAGS "$SCRIPT_DIR/poc_real.cpp" $LINK_FLAGS $EXTRA_ABSL_LIBS -lz -Wl,-framework,CoreFoundation -lc++ -o "$OUTPUT"; then
  :
else
  echo "build failed after retries" >&2
  exit 1
fi

codesign -s - -f "$OUTPUT" >/dev/null 2>&1 || true
echo "[+] built $OUTPUT"
