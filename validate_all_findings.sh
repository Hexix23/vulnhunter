#!/bin/bash
#
# validate_all_findings.sh - Run 4-validator consensus on all findings
#
# Usage: ./validate_all_findings.sh [target] [--parallel N] [--skip-validated]
#
# Example:
#   ./validate_all_findings.sh protobuf --parallel 3
#   ./validate_all_findings.sh protobuf --skip-validated
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-protobuf}"
PARALLEL=2
SKIP_VALIDATED=false

# Parse args
shift || true
while [[ $# -gt 0 ]]; do
    case $1 in
        --parallel) PARALLEL="$2"; shift 2 ;;
        --skip-validated) SKIP_VALIDATED=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

BUGS_DIR="$SCRIPT_DIR/bugs/$TARGET"
BUILD_DIR="$SCRIPT_DIR/builds/${TARGET}-asan-$(uname -m)"

# Verify build exists
if [[ ! -f "$BUILD_DIR/compile_flags.txt" ]]; then
    echo "ERROR: No ASan build found at $BUILD_DIR"
    echo "Run build-agent first."
    exit 1
fi

echo "=============================================="
echo " VulnHunter - Validate All Findings"
echo "=============================================="
echo "Target: $TARGET"
echo "Build: $BUILD_DIR"
echo "Parallel: $PARALLEL validators at once"
echo "Skip validated: $SKIP_VALIDATED"
echo ""

# Collect findings to validate
FINDINGS=()
for finding_dir in "$BUGS_DIR"/*/; do
    finding_name=$(basename "$finding_dir")

    # Skip if no poc directory
    if [[ ! -d "${finding_dir}poc" ]]; then
        echo "SKIP: $finding_name (no PoC)"
        continue
    fi

    # Skip if already validated and flag set
    if $SKIP_VALIDATED && [[ -d "${finding_dir}validation" ]]; then
        echo "SKIP: $finding_name (already validated)"
        continue
    fi

    FINDINGS+=("$finding_name")
done

echo ""
echo "Findings to validate: ${#FINDINGS[@]}"
echo "${FINDINGS[*]}"
echo ""

# Generate Claude prompt for batch validation
generate_validation_prompt() {
    local finding="$1"
    local finding_dir="$BUGS_DIR/$finding"

    # Read finding info if exists
    local finding_info=""
    if [[ -f "${finding_dir}/poc/FINDING.md" ]]; then
        finding_info=$(head -50 "${finding_dir}/poc/FINDING.md" 2>/dev/null || true)
    elif [[ -f "${finding_dir}/poc/finding.json" ]]; then
        finding_info=$(cat "${finding_dir}/poc/finding.json" 2>/dev/null || true)
    fi

    cat <<EOF
You are a software reliability engineer validating a code finding.

## Finding: $finding
## Target: $TARGET
## Build Directory: $BUILD_DIR

## Finding Info:
$finding_info

## Task: Run 4 validators and calculate consensus

### Step 1: ASan Validator
Compile and run the PoC against the real ASan-instrumented library.
- Use compile_flags.txt and link_flags.txt from build directory
- Capture any ASan output
- Status: CONFIRMED_MEMORY / LOGIC_BUG / NO_CRASH

### Step 2: LLDB Debugger
Run the PoC under LLDB to capture state evidence.
- Set breakpoints at key functions
- Capture variable values showing incorrect state
- Status: STATE_BUG / STATE_OK

### Step 3: Fresh Validator
Independently analyze the code WITHOUT knowing the expected bug.
- Read the vulnerable function
- Document any issues you find
- Status: FOUND / NOT_FOUND / FOUND_DIFFERENT

### Step 4: Impact Validator
Demonstrate practical consequences.
- Trace entry points from public API
- Show what happens when triggered
- Status: DEMONSTRATED / LIMITED_IMPACT / NO_PRACTICAL_IMPACT

### Step 5: Calculate Consensus
Based on validator results:
- Score each validator (see consensus-analyzer for weights)
- Total >= 3.0: CONFIRMED_HIGH
- Total 2.0-2.9: CONFIRMED
- Total 1.0-1.9: LIKELY
- Total < 1.0: UNCERTAIN

### Output
Create these files in bugs/$TARGET/$finding/validation/:
1. asan_result.json
2. lldb_result.json
3. fresh_result.json
4. impact_result.json
5. consensus_result.json
6. VALIDATION_STATUS.md

Be thorough. Use retry logic if compilation fails.
EOF
}

# Create validation queue file
QUEUE_FILE=$(mktemp /tmp/vulnhunt_queue.XXXXXX)
for finding in "${FINDINGS[@]}"; do
    echo "$finding" >> "$QUEUE_FILE"
done

echo "Queue file: $QUEUE_FILE"
echo ""
echo "To validate all findings, run:"
echo ""
echo "  claude -p \"$(cat <<'PROMPT'
You are the VulnHunter orchestrator. Read the queue file and validate each finding.

For each finding in the queue:
1. Launch Agent with subagent_type: "codex:codex-rescue"
2. Pass the validation prompt for that finding
3. Wait for completion
4. Move to next finding

Process up to 3 findings in parallel for efficiency.

Queue file: /tmp/vulnhunt_queue.XXXXXX
Target: protobuf
Build: builds/protobuf-asan-arm64/

Start validating now.
PROMPT
)\""
echo ""

# Or run directly with this script
if [[ "${RUN_NOW:-false}" == "true" ]]; then
    echo "Running validation..."

    for finding in "${FINDINGS[@]}"; do
        echo ""
        echo "=============================================="
        echo "Validating: $finding"
        echo "=============================================="

        prompt=$(generate_validation_prompt "$finding")

        # Launch via Claude with Codex
        echo "$prompt" | claude --print 2>&1 | tee "$BUGS_DIR/$finding/validation_log.txt" || true

        echo "Done: $finding"
    done
fi

echo ""
echo "=============================================="
echo "Alternative: Direct Claude invocation"
echo "=============================================="
echo ""
echo "Run this in Claude Code to validate all:"
echo ""
cat <<'INSTRUCTIONS'
For each finding that needs validation, I will:
1. Read the finding's PoC and info
2. Launch 4 validators via Codex agents (parallel where possible)
3. Calculate consensus score
4. Save results

Findings to validate:
INSTRUCTIONS

printf '  - %s\n' "${FINDINGS[@]}"

echo ""
echo "Say 'validate all' to start, or 'validate <name>' for a specific finding."
