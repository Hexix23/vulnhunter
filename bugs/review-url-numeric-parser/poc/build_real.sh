#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread"
BUILD_DIR="${ROOT}/build_asan"
SRC="${ROOT}/bugs/review-url-numeric-parser/poc/poc_real.cpp"
OUT="${ROOT}/bugs/review-url-numeric-parser/poc/poc_real"

c++ \
  -fsanitize=address -g -std=c++17 \
  -I"${ROOT}/include" \
  -I"${ROOT}/src" \
  -I"${ROOT}/src/core" \
  "${SRC}" \
  "${BUILD_DIR}/src/lib/url/libopenthread-url.a" \
  -o "${OUT}"

printf 'built %s\n' "${OUT}"
