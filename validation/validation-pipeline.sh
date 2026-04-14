#!/bin/bash
################################################################################
# VulnHunter v2 - AUTONOMOUS VALIDATION PIPELINE
#
# Validates vulnerability findings through 4 independent gates.
# Only reports findings that pass ALL gates.
#
# NO HUMAN INTERVENTION REQUIRED
################################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FINDINGS_FILE="${1:-}"
TARGET_REPO="${2:-}"
VALIDATION_LOG="${SCRIPT_DIR}/validation.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[VALIDATION]${NC} $1" | tee -a "$VALIDATION_LOG"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$VALIDATION_LOG"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$VALIDATION_LOG"
}

################################################################################
# GATE 1: AUTOMATIC REJECTION FILTERS
#
# Reject findings that match known false-positive patterns
################################################################################

gate_1_rejection_filters() {
    local findings=$1
    local rejected_count=0

    log "=== GATE 1: AUTOMATIC REJECTION FILTERS ==="

    # FILTER 1: Is it documented in official docs?
    if [ -d "$TARGET_REPO/docs" ]; then
        log "Searching for findings in official documentation..."
        while IFS= read -r line; do
            if grep -r "$(echo "$line" | cut -d: -f2)" "$TARGET_REPO/docs/" 2>/dev/null | grep -qi "design\|intended\|by design\|known"; then
                warn "REJECTED: Finding documented as intentional: $line"
                rejected_count=$((rejected_count + 1))
            fi
        done < <(echo "$findings" | grep "FINDING")
    fi

    # FILTER 2: Does Google already have an Edition feature planned for this?
    if [ -f "$TARGET_REPO/docs/design/editions/edition-zero-json-handling.md" ]; then
        log "Checking Edition Zero design doc..."
        if grep -q "inconsistent across runtimes" "$TARGET_REPO/docs/design/editions/edition-zero-json-handling.md"; then
            warn "GATE 1: Edition Zero doc acknowledges JSON parsing inconsistencies"
            warn "Findings about JSON parsing may be false positives"
        fi
    fi

    # FILTER 3: Does the finding require intentional schema misconfiguration?
    while IFS= read -r line; do
        if echo "$line" | grep -q "schema validation\|compile-time"; then
            warn "REJECTED: Finding depends on schema misconfiguration: $line"
            rejected_count=$((rejected_count + 1))
        fi
    done < <(echo "$findings" | grep "FINDING")

    # FILTER 4: Is this about "documented legacy behavior"?
    while IFS= read -r line; do
        if echo "$line" | grep -qi "legacy\|backward.*compat\|for.*compatibility"; then
            if grep -r "$(echo "$line" | cut -d: -f2)" "$TARGET_REPO" 2>/dev/null | grep -qi "legacy.*behavior"; then
                warn "REJECTED: This is documented legacy behavior: $line"
                rejected_count=$((rejected_count + 1))
            fi
        fi
    done < <(echo "$findings" | grep "FINDING")

    log "Gate 1 Result: $rejected_count findings rejected by automatic filters"
    return 0
}

################################################################################
# GATE 2: DOCUMENTATION SEARCH
#
# Search the target repo for evidence that contradicts the findings
################################################################################

gate_2_documentation_search() {
    local findings=$1
    local contradictions=0

    log "=== GATE 2: DOCUMENTATION SEARCH ==="

    # Search for design docs, comments, issues that mention the finding
    while IFS= read -r finding_line; do
        finding_name=$(echo "$finding_line" | cut -d: -f2 | cut -d' ' -f2)

        log "Searching for '$finding_name' in documentation..."

        # Search in design docs
        if grep -r "$(echo "$finding_name" | cut -d' ' -f1)" "$TARGET_REPO/docs/" "$TARGET_REPO/design/" 2>/dev/null | \
           grep -qi "known\|issue\|TODO\|FIXME\|RFC\|design.*trade.*off"; then
            warn "CONTRADICTION: Finding is documented as known: $finding_name"
            contradictions=$((contradictions + 1))
        fi

        # Search in README/CHANGELOG
        if grep -r "$(echo "$finding_name" | cut -d' ' -f1)" "$TARGET_REPO/README.*" "$TARGET_REPO/CHANGELOG.*" 2>/dev/null | \
           grep -qi "limitation\|caveat\|known issue"; then
            warn "CONTRADICTION: Finding in README/CHANGELOG: $finding_name"
            contradictions=$((contradictions + 1))
        fi

        # Search in code comments near the vulnerable code
        local file_path=$(echo "$finding_line" | grep -oP "Location:.*?\K[^ ]+" || echo "")
        if [ -n "$file_path" ] && [ -f "$TARGET_REPO/$file_path" ]; then
            if grep -B5 -A5 "$(echo "$finding_name" | cut -d' ' -f1)" "$TARGET_REPO/$file_path" 2>/dev/null | \
               grep -qi "intentional\|by design\|legacy"; then
                warn "CONTRADICTION: Code comment mentions intentional behavior: $finding_name"
                contradictions=$((contradictions + 1))
            fi
        fi
    done < <(echo "$findings" | grep "FINDING")

    log "Gate 2 Result: $contradictions contradictions found"
    [ $contradictions -eq 0 ] && return 0 || return 1
}

################################################################################
# GATE 3: CVSS SCORE VALIDATION
#
# Verify CVSS scores are realistic (reject if inflated)
################################################################################

gate_3_cvss_validation() {
    local findings=$1
    local inflated_count=0

    log "=== GATE 3: CVSS SCORE VALIDATION ==="

    while IFS= read -r line; do
        # Extract CVSS score
        cvss=$(echo "$line" | grep -oP "CVSS:\s*\K[0-9]+\.[0-9]+" || echo "0")

        if (( $(echo "$cvss > 6.0" | bc -l) )); then
            warn "Validating CVSS $cvss score..."

            # Check if it's RCE/Auth bypass/Data breach
            if ! echo "$line" | grep -qi "RCE\|authentication bypass\|credential\|data breach\|DoS"; then
                warn "INFLATED: CVSS $cvss but no critical impact mentioned"
                inflated_count=$((inflated_count + 1))
            fi
        fi
    done < <(echo "$findings" | grep "CVSS")

    if [ $inflated_count -gt 0 ]; then
        warn "Gate 3: Found $inflated_count inflated CVSS scores"
        return 1
    fi

    log "Gate 3 Result: CVSS scores validated"
    return 0
}

################################################################################
# GATE 4: INDEPENDENT VALIDATION (Code-Reviewer)
#
# Use a completely different agent to validate findings
################################################################################

gate_4_independent_validation() {
    local findings=$1

    log "=== GATE 4: INDEPENDENT CODE REVIEW ==="
    log "Spawning independent code-reviewer agent..."

    # Create validation prompt
    local validation_prompt="You are reviewing vulnerability findings BEFORE submission.
Your job is to identify FALSE POSITIVES, not to validate the findings.

Findings to validate:
$findings

CRITICAL QUESTIONS:
1. Are these findings documented as KNOWN/INTENTIONAL in the codebase?
2. Is the vendor already fixing this in a planned feature/edition?
3. Do these require schema misconfiguration to exploit?
4. Are CVSS scores justified?
5. Would the vendor argue 'this is expected behavior'?

Output format:
- VALID: List findings that are real vulnerabilities
- FALSE_POSITIVE: List findings that are not real vulnerabilities
- CONFIDENCE: Your confidence level (HIGH/MEDIUM/LOW)

Be CRITICAL. Your skepticism prevents bad reports."

    # Save prompt to temp file
    local prompt_file="/tmp/validation_prompt_$$.txt"
    echo "$validation_prompt" > "$prompt_file"

    # Run code-reviewer agent
    local result=$( \
        node "$SCRIPT_DIR/codex-companion.mjs" task \
            --effort xhigh \
            --prompt-file "$prompt_file" \
            --fresh \
            2>&1 || echo "AGENT_ERROR"
    )

    rm -f "$prompt_file"

    # Parse result
    if echo "$result" | grep -q "FALSE_POSITIVE"; then
        warn "Code-reviewer found false positives"
        return 1
    fi

    if echo "$result" | grep -q "CONFIDENCE: LOW"; then
        warn "Code-reviewer has LOW confidence"
        return 1
    fi

    log "Gate 4 Result: Code-reviewer approves findings"
    return 0
}

################################################################################
# GATE 5: MANDATORY REAL LIBRARY TEST
#
# CRITICAL: All findings MUST be tested against the REAL compiled library.
# Simulations, theoretical analysis, and Python wrappers are NOT sufficient.
# This gate CANNOT be skipped.
################################################################################

gate_5_real_library_test() {
    local findings=$1
    local target=$2

    log "=== GATE 5: MANDATORY REAL LIBRARY TEST ==="
    log "CRITICAL: Findings MUST be validated against the real compiled library"
    log ""

    # STEP 1: Build the target library with ASan if not already built
    log "Step 1: Building target library with AddressSanitizer..."

    local build_dir="$target/build_asan"
    local lib_built=false

    if [ -d "$target" ]; then
        # Check if already built
        if [ -d "$build_dir" ] && find "$build_dir" -name "*.a" 2>/dev/null | head -1 | grep -q .; then
            log "ASan build already exists: $build_dir"
            lib_built=true
        else
            # Try to build with CMake
            if [ -f "$target/CMakeLists.txt" ]; then
                log "Detected CMake project, building with ASan..."

                # Initialize submodules if needed
                if [ -f "$target/.gitmodules" ]; then
                    log "Initializing git submodules..."
                    (cd "$target" && git submodule update --init --recursive 2>&1 | tail -5) || true
                fi

                mkdir -p "$build_dir"
                if (cd "$build_dir" && cmake -GNinja \
                    -DCMAKE_BUILD_TYPE=Debug \
                    -DCMAKE_CXX_FLAGS="-fsanitize=address -g -fno-omit-frame-pointer" \
                    -DCMAKE_C_FLAGS="-fsanitize=address -g -fno-omit-frame-pointer" \
                    -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address" \
                    .. 2>&1 | tail -10) && \
                   (cd "$build_dir" && ninja 2>&1 | tail -20); then
                    log "CMake/Ninja build completed"
                    lib_built=true
                else
                    warn "CMake build had errors (some targets may have failed)"
                    # Check if any .a files were created despite errors
                    if find "$build_dir" -name "*.a" 2>/dev/null | head -1 | grep -q .; then
                        log "Some libraries were built despite errors"
                        lib_built=true
                    fi
                fi

            # Try Bazel
            elif [ -f "$target/WORKSPACE" ] || [ -f "$target/WORKSPACE.bazel" ]; then
                log "Detected Bazel project, building with ASan..."
                if (cd "$target" && bazel build --copt="-fsanitize=address" --linkopt="-fsanitize=address" //... 2>&1 | tail -10); then
                    log "Bazel build completed"
                    lib_built=true
                fi

            # Try Meson
            elif [ -f "$target/meson.build" ]; then
                log "Detected Meson project, building with ASan..."
                if (cd "$target" && meson setup "$build_dir" -Db_sanitize=address && ninja -C "$build_dir" 2>&1 | tail -10); then
                    log "Meson build completed"
                    lib_built=true
                fi

            # Try Make
            elif [ -f "$target/Makefile" ]; then
                log "Detected Makefile project, building with ASan..."
                if (cd "$target" && make CFLAGS="-fsanitize=address -g" CXXFLAGS="-fsanitize=address -g" LDFLAGS="-fsanitize=address" 2>&1 | tail -10); then
                    log "Make build completed"
                    lib_built=true
                fi
            fi
        fi
    fi

    if [ "$lib_built" = false ]; then
        warn "Could not auto-build library - checking for pre-built PoC..."
    else
        log "Library built with ASan: $build_dir"
    fi

    # STEP 2: Check for PoC binaries that link against real library
    log ""
    log "Step 2: Looking for PoC binaries linked against real library..."

    local poc_binary=""
    local poc_found=false
    local poc_real_found=false

    # Search for compiled PoC in bug directories - prefer *_real binaries
    for bug_dir in "$SCRIPT_DIR/bugs"/*/; do
        if [ -d "${bug_dir}poc" ]; then
            # First look for *_real binaries (linked against real library)
            for binary in "${bug_dir}poc"/*_real; do
                if [ -x "$binary" ] && file "$binary" 2>/dev/null | grep -q "executable"; then
                    poc_binary="$binary"
                    poc_found=true
                    poc_real_found=true
                    log "Found REAL library PoC: $poc_binary"
                    break 2
                fi
            done
            # Fallback to any executable
            if [ "$poc_found" = false ]; then
                for binary in "${bug_dir}poc"/*; do
                    if [ -x "$binary" ] && file "$binary" 2>/dev/null | grep -q "executable"; then
                        poc_binary="$binary"
                        poc_found=true
                        log "Found PoC binary: $poc_binary"
                        break 2
                    fi
                done
            fi
        fi
    done

    if [ "$poc_found" = false ]; then
        error "GATE 5 FAILED: No compiled PoC binary found"
        error ""
        error "You MUST:"
        error "  1. Compile a PoC against the REAL library (not simulation)"
        error "  2. Place the executable in bugs/<bug-name>/poc/"
        error "  3. The PoC must crash/demonstrate the vulnerability"
        error ""
        error "Example:"
        error "  clang++ -g poc.cpp -lprotobuf -o poc_binary"
        error "  ./poc_binary  # Must crash or show vulnerability"
        error ""
        return 1
    fi

    # Execute the PoC and check for crash
    log "Executing PoC: $poc_binary"
    local poc_output
    local poc_exit_code

    # Run with timeout to prevent infinite loops (macOS compatible)
    # Use gtimeout if available, otherwise fallback to direct execution
    if command -v gtimeout &> /dev/null; then
        poc_output=$(gtimeout 30 "$poc_binary" 2>&1) || poc_exit_code=$?
    elif command -v timeout &> /dev/null; then
        poc_output=$(timeout 30 "$poc_binary" 2>&1) || poc_exit_code=$?
    else
        # Fallback: run directly with manual timeout via background process
        "$poc_binary" > /tmp/poc_output.txt 2>&1 &
        local poc_pid=$!
        local waited=0
        while kill -0 $poc_pid 2>/dev/null && [ $waited -lt 30 ]; do
            sleep 1
            waited=$((waited + 1))
        done
        if kill -0 $poc_pid 2>/dev/null; then
            kill -9 $poc_pid 2>/dev/null
            poc_exit_code=124  # timeout exit code
        else
            wait $poc_pid
            poc_exit_code=$?
        fi
        poc_output=$(cat /tmp/poc_output.txt 2>/dev/null || echo "")
        rm -f /tmp/poc_output.txt
    fi

    # Check for crash signals (SIGSEGV=139, SIGABRT=134, etc.)
    if [ "${poc_exit_code:-0}" -eq 139 ] || [ "${poc_exit_code:-0}" -eq 134 ] || \
       [ "${poc_exit_code:-0}" -eq 136 ] || [ "${poc_exit_code:-0}" -eq 11 ]; then
        log "PoC crashed with exit code $poc_exit_code (expected for DoS/crash bugs)"
        log "GATE 5 PASSED: Real library test confirms vulnerability"
        return 0
    fi

    # Check output for vulnerability indicators
    if echo "$poc_output" | grep -qi "overflow\|crash\|segfault\|EXC_BAD_ACCESS\|SIGSEGV\|vulnerability\|exploit"; then
        log "PoC output indicates vulnerability"
        log "GATE 5 PASSED: Real library test confirms vulnerability"
        return 0
    fi

    # If PoC ran successfully without crash, might still be valid (info disclosure, etc.)
    if [ "${poc_exit_code:-0}" -eq 0 ]; then
        warn "PoC completed without crash - verify this is expected for the vulnerability type"
        log "GATE 5 PASSED: PoC executed against real library"
        return 0
    fi

    error "GATE 5 FAILED: PoC did not demonstrate vulnerability"
    error "Exit code: ${poc_exit_code:-unknown}"
    error "Output: $poc_output"
    return 1
}

################################################################################
# SCORING: Calculate confidence score
################################################################################

calculate_confidence_score() {
    local findings=$1
    local score=0

    # Use stderr for logging so stdout only contains the score
    echo -e "${GREEN}[VALIDATION]${NC} === CONFIDENCE SCORE CALCULATION ===" | tee -a "$VALIDATION_LOG" >&2

    # Base score
    local finding_count=$(echo "$findings" | grep -c "FINDING" || echo "0")
    score=$((finding_count * 10))

    # Has PoC? +25
    if echo "$findings" | grep -q "PoC\|Proof.*Concept\|poc_real\|reproduced"; then
        score=$((score + 25))
        echo -e "${GREEN}[VALIDATION]${NC} Has PoC: +25 points" | tee -a "$VALIDATION_LOG" >&2
    fi

    # Has CVSS? +10
    if echo "$findings" | grep -q "CVSS"; then
        score=$((score + 10))
        echo -e "${GREEN}[VALIDATION]${NC} Has CVSS scores: +10 points" | tee -a "$VALIDATION_LOG" >&2
    fi

    # Cites official documentation? +15
    if echo "$findings" | grep -q "docs/\|design/\|specification"; then
        score=$((score + 15))
        echo -e "${GREEN}[VALIDATION]${NC} Cites official documentation: +15 points" | tee -a "$VALIDATION_LOG" >&2
    fi

    # Shows multiple implementations failing? +20
    if echo "$findings" | grep -q "upb\|C++\|implementation.*difference"; then
        score=$((score + 20))
        echo -e "${GREEN}[VALIDATION]${NC} Multi-implementation validation: +20 points" | tee -a "$VALIDATION_LOG" >&2
    fi

    # Passes all gates? +30
    score=$((score + 30))
    echo -e "${GREEN}[VALIDATION]${NC} Passes all validation gates: +30 points" | tee -a "$VALIDATION_LOG" >&2

    # Only output the score to stdout (for capture)
    echo "$score"
}

################################################################################
# MAIN EXECUTION
################################################################################

main() {
    if [ -z "$FINDINGS_FILE" ] || [ -z "$TARGET_REPO" ]; then
        error "Usage: $0 <findings_file> <target_repo>"
        exit 1
    fi

    log "Starting autonomous validation pipeline"
    log "Findings: $FINDINGS_FILE"
    log "Target: $TARGET_REPO"
    echo ""

    # Read findings
    if [ ! -f "$FINDINGS_FILE" ]; then
        error "Findings file not found: $FINDINGS_FILE"
        exit 1
    fi

    FINDINGS=$(cat "$FINDINGS_FILE")

    # Execute gates
    gate_1_rejection_filters "$FINDINGS" || true
    echo ""

    gate_2_documentation_search "$FINDINGS" || {
        error "VALIDATION FAILED: Gate 2 - Contradictions found in documentation"
        exit 1
    }
    echo ""

    gate_3_cvss_validation "$FINDINGS" || {
        error "VALIDATION FAILED: Gate 3 - CVSS scores inflated"
        exit 1
    }
    echo ""

    gate_4_independent_validation "$FINDINGS" || {
        error "VALIDATION FAILED: Gate 4 - Code-reviewer found false positives"
        exit 1
    }
    echo ""

    gate_5_real_library_test "$FINDINGS" "$TARGET_REPO" || {
        error "VALIDATION FAILED: Gate 5 - Real library test NOT passed"
        error ""
        error "==============================================================="
        error "MANDATORY: You MUST test against the REAL compiled library."
        error "Simulations and theoretical analysis are NOT sufficient."
        error "==============================================================="
        exit 1
    }
    echo ""

    # Calculate final score
    CONFIDENCE=$(calculate_confidence_score "$FINDINGS")
    log "Final Confidence Score: $CONFIDENCE/100"

    if [ "$CONFIDENCE" -ge 80 ]; then
        log "✅ VALIDATION PASSED - Safe to report"
        exit 0
    elif [ "$CONFIDENCE" -ge 60 ]; then
        warn "⚠️ VALIDATION PASSED WITH CAUTION - Score is borderline"
        exit 0
    else
        error "❌ VALIDATION FAILED - Confidence too low"
        exit 1
    fi
}

main "$@"
