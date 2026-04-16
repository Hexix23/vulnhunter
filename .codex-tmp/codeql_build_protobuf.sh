#!/usr/bin/env bash
set -euo pipefail

cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf
cmake -B build-codeql
cmake --build build-codeql
