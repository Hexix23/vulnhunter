#!/usr/bin/env bash
set -euo pipefail

WORK_ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
ROOT="${WORK_ROOT}/targets/openthread"
BUILD_DIR="${ROOT}/build_asan"
SRC="${WORK_ROOT}/bugs/openthread-radiourl-oob/poc/poc_real.cpp"
OUT="${WORK_ROOT}/bugs/openthread-radiourl-oob/poc/poc_real"

c++ \
  -fsanitize=address -g -std=c++17 \
  -I"${ROOT}/include" \
  -I"${ROOT}/src" \
  -I"${ROOT}/src/core" \
  -I"${ROOT}/src/include" \
  -I"${ROOT}/src/posix/platform/include" \
  "${SRC}" \
  "${BUILD_DIR}/manual/lib/libopenthread-posix-radio.a" \
  "${BUILD_DIR}/manual/lib/libopenthread-url.a" \
  "${BUILD_DIR}/manual/lib/libopenthread-platform.a" \
  -o "${OUT}"

printf 'built %s\n' "${OUT}"
