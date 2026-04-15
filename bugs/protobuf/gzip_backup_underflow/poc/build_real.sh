#!/bin/bash
set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
OUT_DIR="$ROOT/bugs/protobuf/gzip_backup_underflow/poc"

cd "$OUT_DIR" || exit 1

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

attempt_compile() {
  echo "[*] $*"
  "$@"
}

attempt_compile clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -o poc_real
status=$?

if [ $status -ne 0 ]; then
  attempt_compile clang++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -lz -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt_compile clang++ -stdlib=libc++ $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -lz -lc++ -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt_compile xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -lz -lc++ -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  attempt_compile xcrun clang++ -arch arm64 $COMPILE_FLAGS poc_real.cpp $LINK_FLAGS -lz \
    -labsl_cord -labsl_cord_internal -labsl_cordz_info \
    -Wl,-rpath,/opt/homebrew/opt/abseil/lib -o poc_real
  status=$?
fi

if [ $status -ne 0 ]; then
  echo "[!] build failed after retries"
  exit $status
fi

codesign -s - -f poc_real >/dev/null 2>&1 || true
echo "[+] built $OUT_DIR/poc_real"
