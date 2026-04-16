#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
TARGET="$ROOT/targets/protobuf"

cd "$TARGET"

if [ -f "build-asan-codex/build.ninja" ] || [ -f "build-asan-codex/Makefile" ]; then
  cmake --build build-asan-codex --clean-first
else
  cmake -S . -B build-codeql
  cmake --build build-codeql --clean-first
fi
