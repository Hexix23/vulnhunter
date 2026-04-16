#!/bin/bash
# Reset VulnHunter session while preserving findings and learned patterns

set -e

VULNHUNTER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_DIR="$VULNHUNTER_ROOT/archive"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== VulnHunter Session Reset ==="
echo "Root: $VULNHUNTER_ROOT"
echo ""
echo "PRESERVING: learned/ (CodeQL patterns that improve over time)"

# 1. Archive current findings (if any)
if [ -d "$VULNHUNTER_ROOT/bugs" ] && [ "$(ls -A $VULNHUNTER_ROOT/bugs 2>/dev/null)" ]; then
    mkdir -p "$ARCHIVE_DIR"
    ARCHIVE_NAME="findings_$TIMESTAMP"
    echo "[1/4] Archiving findings to: archive/$ARCHIVE_NAME/"
    cp -r "$VULNHUNTER_ROOT/bugs" "$ARCHIVE_DIR/$ARCHIVE_NAME"
    echo "      Archived $(find $ARCHIVE_DIR/$ARCHIVE_NAME -type f | wc -l | tr -d ' ') files"
else
    echo "[1/4] No findings to archive"
fi

# 2. Clear state
if [ -d "$VULNHUNTER_ROOT/state" ]; then
    echo "[2/4] Clearing state/"
    rm -rf "$VULNHUNTER_ROOT/state"
    mkdir -p "$VULNHUNTER_ROOT/state"
else
    echo "[2/4] No state to clear"
fi

# 3. Clear bugs (fresh start)
if [ -d "$VULNHUNTER_ROOT/bugs" ]; then
    echo "[3/4] Clearing bugs/"
    rm -rf "$VULNHUNTER_ROOT/bugs"
    mkdir -p "$VULNHUNTER_ROOT/bugs"
else
    echo "[3/4] No bugs to clear"
fi

# 4. Clear builds (force recompilation)
if [ -d "$VULNHUNTER_ROOT/builds" ]; then
    echo "[4/4] Clearing builds/"
    rm -rf "$VULNHUNTER_ROOT/builds"
    mkdir -p "$VULNHUNTER_ROOT/builds"
else
    echo "[4/4] No builds to clear"
fi

echo ""
echo "=== Reset Complete ==="
echo ""
echo "ARCHIVED:   archive/$ARCHIVE_NAME/"
echo "CLEARED:    state/, bugs/, builds/"
echo "PRESERVED:  learned/ (CodeQL patterns)"
echo ""
echo "Ready for fresh analysis."
