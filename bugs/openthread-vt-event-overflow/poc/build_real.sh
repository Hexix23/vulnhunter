#!/usr/bin/env bash
set -euo pipefail

WORK_ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
ROOT="${WORK_ROOT}/targets/openthread"
BUILD_DIR="${ROOT}/build_posix_vt_asan"
SRC="${WORK_ROOT}/bugs/openthread-vt-event-overflow/poc/poc_real.cpp"
OUT="${WORK_ROOT}/bugs/openthread-vt-event-overflow/poc/poc_real"

c++ \
  -fsanitize=address -g -fno-omit-frame-pointer -std=c++17 \
  -I"${ROOT}/include" \
  -I"${ROOT}/src" \
  -I"${ROOT}/src/core" \
  -I"${ROOT}/src/include" \
  -I"${ROOT}/src/posix/platform/include" \
  "${SRC}" \
  "${BUILD_DIR}/src/posix/platform/libopenthread-posix.a" \
  "${BUILD_DIR}/src/lib/platform/libopenthread-platform.a" \
  "${BUILD_DIR}/src/lib/hdlc/libopenthread-hdlc.a" \
  "${BUILD_DIR}/src/lib/spinel/libopenthread-radio-spinel.a" \
  "${BUILD_DIR}/src/lib/spinel/libopenthread-spinel-rcp.a" \
  "${BUILD_DIR}/src/lib/url/libopenthread-url.a" \
  "${BUILD_DIR}/src/core/libopenthread-ftd.a" \
  "${BUILD_DIR}/src/cli/libopenthread-cli-ftd.a" \
  "${BUILD_DIR}/third_party/tcplp/libtcplp-ftd.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/library/libmbedcrypto.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/library/libmbedx509.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/library/libmbedtls.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/3rdparty/p256-m/libp256m.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/3rdparty/everest/libeverest.a" \
  -o "${OUT}"

printf 'built %s\n' "${OUT}"
