#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread"
BUILD_DIR="${ROOT}/build_asan"
SRC="${ROOT}/bugs/review-ncp-logic-bugs/poc/poc_real.cpp"
OUT="${ROOT}/bugs/review-ncp-logic-bugs/poc/poc_real"

c++ \
  -fsanitize=address -g -std=c++17 \
  -DOPENTHREAD_FTD=1 \
  -DOPENTHREAD_MTD=0 \
  -DOPENTHREAD_RADIO=0 \
  -DOPENTHREAD_SPINEL_CONFIG_OPENTHREAD_MESSAGE_ENABLE=1 \
  -I"${ROOT}/include" \
  -I"${ROOT}/src" \
  -I"${ROOT}/src/core" \
  -I"${ROOT}/tests/unit" \
  "${SRC}" \
  "${ROOT}/tests/unit/test_platform.cpp" \
  "${ROOT}/tests/unit/test_util.cpp" \
  "${BUILD_DIR}/src/ncp/libopenthread-ncp-ftd.a" \
  "${BUILD_DIR}/src/lib/spinel/libopenthread-spinel-ncp.a" \
  "${BUILD_DIR}/src/lib/hdlc/libopenthread-hdlc.a" \
  "${BUILD_DIR}/src/core/libopenthread-ftd.a" \
  "${BUILD_DIR}/src/lib/url/libopenthread-url.a" \
  "${BUILD_DIR}/third_party/tcplp/libtcplp-ftd.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/library/libmbedcrypto.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/library/libmbedx509.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/library/libmbedtls.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/3rdparty/p256-m/libp256m.a" \
  "${BUILD_DIR}/third_party/mbedtls/repo/3rdparty/everest/libeverest.a" \
  -o "${OUT}"

printf 'built %s\n' "${OUT}"
