#!/usr/bin/env bash
# PoC Build Script Template
# Builds both ASan version (for crash) and debug version (for LLDB)

set -euo pipefail

# Configuration - UPDATE THESE
REPO="/path/to/target/repo"
POC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POC_SOURCE="${POC_DIR}/exploit.cpp"

# Target source files - ADD vulnerable files
TARGET_SOURCES=(
    "${REPO}/src/vulnerable_file.cpp"
    # Add more source files as needed
)

# Include paths - ADD as needed
INCLUDES=(
    "-I${REPO}"
    "-I${REPO}/src"
    "-I${REPO}/include"
)

# Output binaries
OUT_ASAN="${POC_DIR}/exploit"
OUT_DEBUG="${POC_DIR}/exploit_debug"

# Common flags
COMMON_FLAGS="-std=c++17 ${INCLUDES[*]}"

echo "=== Building PoC ==="
echo "Repository: $REPO"
echo "PoC: $POC_SOURCE"

# Build with ASan (for crash confirmation)
echo ""
echo "[1/2] Building with AddressSanitizer..."
c++ -fsanitize=address -g -O1 $COMMON_FLAGS \
    "$POC_SOURCE" \
    "${TARGET_SOURCES[@]}" \
    -o "$OUT_ASAN"
echo "Built: $OUT_ASAN"

# Build for debugging (no ASan, full symbols)
echo ""
echo "[2/2] Building debug version (for LLDB)..."
c++ -g -O0 $COMMON_FLAGS \
    "$POC_SOURCE" \
    "${TARGET_SOURCES[@]}" \
    -o "$OUT_DEBUG"
echo "Built: $OUT_DEBUG"

echo ""
echo "=== Build Complete ==="
echo ""
echo "Usage:"
echo "  ASan crash:  $OUT_ASAN [args]"
echo "  LLDB debug:  lldb $OUT_DEBUG"
echo ""
echo "LLDB batch:"
echo "  lldb -b -s lldb_commands.txt $OUT_DEBUG"
