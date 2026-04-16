#!/bin/bash
set -e
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf
cmake -B build-codeql
cmake --build build-codeql
