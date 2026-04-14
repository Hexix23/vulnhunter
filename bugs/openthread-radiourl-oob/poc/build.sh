#!/usr/bin/env bash
set -euo pipefail

REPO="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread"
POC_DIR="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/openthread-radiourl-oob/poc"
OUT="${POC_DIR}/radiourl_oob"

c++ -fsanitize=address -g -O1 -std=c++17 \
  -I"${REPO}" \
  -I"${REPO}/src" \
  -I"${REPO}/include" \
  -I"${REPO}/src/include" \
  -I"${REPO}/src/core" \
  -I"${REPO}/src/lib" \
  -I"${REPO}/src/posix/platform" \
  -I"${REPO}/src/posix/platform/include" \
  "${POC_DIR}/radiourl_oob.cpp" \
  "${REPO}/src/posix/platform/radio_url.cpp" \
  "${REPO}/src/lib/url/url.cpp" \
  -o "${OUT}"

echo "Built ${OUT}"
