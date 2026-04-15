#!/bin/bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
BUG_DIR="$ROOT/bugs/protobuf/protobuf-input-003"
POC_DIR="$BUG_DIR/poc"
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
PROTOC="$ROOT/targets/protobuf/build-audit-plain-arm64/protoc"

cd "$POC_DIR"

set +e
"$PROTOC" -I"$POC_DIR" --cpp_out="$POC_DIR" "$POC_DIR/packed_fixed32.proto"
status=$?
if [ $status -ne 0 ]; then
  /opt/homebrew/bin/protoc -I"$POC_DIR" --cpp_out="$POC_DIR" "$POC_DIR/packed_fixed32.proto"
  status=$?
fi
set -e

if [ $status -ne 0 ]; then
  exit $status
fi

COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"
SDK_ZLIB="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.4.sdk/usr/lib/libz.tbd"
UPB_LIB="$BUILD_DIR/lib/libupb.a"
UTF8_RANGE_LIB="$BUILD_DIR/lib/libutf8_range.a"
ABSL_DYLIBS=(/opt/homebrew/lib/libabsl_*.2601.0.0.dylib)

set +e
xcrun clang++ -arch arm64 $COMPILE_FLAGS \
  -I"$POC_DIR" \
  poc_real.cpp packed_fixed32.pb.cc \
  $LINK_FLAGS \
  -o poc_real
status=$?

if [ $status -ne 0 ]; then
  xcrun clang++ -arch arm64 $COMPILE_FLAGS \
    -I"$POC_DIR" -I/opt/homebrew/include \
    poc_real.cpp packed_fixed32.pb.cc \
    $LINK_FLAGS $UPB_LIB $UTF8_RANGE_LIB ${ABSL_DYLIBS[*]} \
    $SDK_ZLIB -Wl,-rpath,/opt/homebrew/lib -Wl,-framework,CoreFoundation \
    -o poc_real
  status=$?
fi
set -e

if [ $status -ne 0 ]; then
  exit $status
fi

codesign -s - -f poc_real 2>/dev/null || true
