#!/bin/bash
# VulnHunter v3 - Shell Orchestrator
# Each phase = fresh claude --print call = no context limit
# State persists in state/context.json = fully resumable

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state/context.json"
AGENTS_DIR="$SCRIPT_DIR/.claude/agents"
LOGS_DIR=""  # Will be set per-session based on session_id
BUILDS_DIR="$SCRIPT_DIR/builds"
SESSION_LOGS_DIR=""  # Per-session subdirectory

# Defaults
TARGET=""
DEPTH="deep"
FOCUS="input"
MAX_RETRIES=1000
PARALLEL_VALIDATORS=3
ORCHESTRATOR="claude"  # claude or codex
MODEL="claude-haiku-4-5-20251001"  # sonnet, opus, haiku (only for claude orchestrator)
BACKGROUND=false
DEBUG=false
PID_FILE=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================================
# ARGUMENT PARSING
# ============================================================================

show_help() {
    cat << 'EOF'
VulnHunter v3 - Shell Orchestrator (Claude + Codex)

USAGE:
  ./run.sh --target ./targets/protobuf [OPTIONS]

OPTIONS:
  --target <path>        Target repository to analyze (required)
  --orchestrator <type>  Orchestration engine: claude|codex (default: claude)
  --model <model>        Claude model: haiku|sonnet|opus (default: haiku, only for --orchestrator claude)
  --depth <level>        Analysis depth: quick|deep|exhaustive (default: deep)
  --focus <area>         Focus area: input|memory|all (default: input)
  --phase <phase>        Start from specific phase (for resuming)
  --fresh                Start fresh analysis from ZERO (new state, no skip known bugs,
                         deduplicates post-discovery against bugs/<target>/)
  --revalidate           Re-validate ALL existing findings in bugs/<target>/ from scratch
                         (clears validation/, re-runs all 4 validators, recalculates consensus)
  --background           Run in background (frees terminal, logs to file)
  --debug                Show all commands + agent output verbosely
  --status               Show current run status
  --stop                 Stop running instance
  --help                 Show this help

PHASES:
  init        → Initialize state, verify target
  build       → Ensure ASan build exists
  discovery   → Find potential vulnerabilities
  validation  → Validate findings with ASan
  chain       → Research exploit chains
  impact      → Calculate CVSS scores
  reporting   → Generate VRP reports
  done        → Complete

EXAMPLES:
  # Terminal 1: Lanzar en background (máximo ahorro)
  ./run.sh --target ./targets/protobuf --orchestrator codex --fresh --background

  # Terminal 2: Ver logs en tiempo real
  tail -f logs/orchestrator.log

  # Ver qué está haciendo el agente (si falla)
  tail -f logs/background_*.log

  # Foreground con DEBUG (ver todos los comandos)
  ./run.sh --target ./targets/protobuf --orchestrator codex --fresh --debug

  # Ver estado
  ./run.sh --target ./targets/protobuf --status

  # Detener
  ./run.sh --target ./targets/protobuf --stop

  # Resume desde validation
  ./run.sh --target ./targets/protobuf --phase validation

  # RE-VALIDATE all existing findings from scratch (recommended!)
  ./run.sh --target ./targets/protobuf --orchestrator codex --revalidate --debug

  # Revalidate in background
  ./run.sh --target ./targets/protobuf --orchestrator codex --revalidate --background

  # Otras opciones:
  # Haiku en background
  ./run.sh --target ./targets/protobuf --orchestrator claude --model haiku --fresh --background

  # Opus foreground
  ./run.sh --target ./targets/protobuf --orchestrator claude --model opus --fresh
EOF
}

FRESH=false
REVALIDATE=false
START_PHASE=""

ACTION=""  # status, stop, or empty

while [[ $# -gt 0 ]]; do
    case $1 in
        --target) TARGET="$2"; shift 2 ;;
        --orchestrator) ORCHESTRATOR="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        --depth) DEPTH="$2"; shift 2 ;;
        --focus) FOCUS="$2"; shift 2 ;;
        --phase) START_PHASE="$2"; shift 2 ;;
        --fresh) FRESH=true; shift ;;
        --revalidate) REVALIDATE=true; shift ;;
        --background) BACKGROUND=true; shift ;;
        --debug) DEBUG=true; shift ;;
        --no-background) shift ;;  # Ignore (used internally)
        --status) ACTION="status"; shift ;;
        --stop) ACTION="stop"; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

if [[ -z "$TARGET" ]]; then
    echo -e "${RED}Error: --target is required${NC}"
    show_help
    exit 1
fi

# Resolve target path
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || {
    echo -e "${RED}Error: Target not found: $TARGET${NC}"
    exit 1
}
TARGET_NAME="$(basename "$TARGET")"

# Detect Rosetta (x86_64 process on ARM64 Mac)
if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" == "1" ]]; then
    ROSETTA_MODE=true
    echo -e "${YELLOW}WARNING: Running under Rosetta (x86_64 translation)${NC}"
    echo -e "${YELLOW}LLDB/GDB debugging disabled - using printf state capture${NC}"
else
    ROSETTA_MODE=false
fi

# Calculate PID file
TARGET_ID=$(echo "$TARGET" | md5sum | cut -c1-8)
PID_FILE="$SCRIPT_DIR/.pids/vulnhunter_${TARGET_ID}.pid"

# ============================================================================
# HANDLE ACTIONS (--status, --stop) THAT DON'T NEED TO START
# ============================================================================

if [[ "$ACTION" == "status" ]]; then
    if [[ ! -f "$STATE_FILE" ]]; then
        echo -e "${YELLOW}No active run${NC}"
        exit 1
    fi

    phase=$(jq -r '.progress.phase' "$STATE_FILE")
    session=$(jq -r '.meta.session_id' "$STATE_FILE")
    stats=$(jq '.statistics' "$STATE_FILE")
    config=$(jq '.config' "$STATE_FILE")

    echo -e "${BLUE}━━━ VulnHunter Status ━━━${NC}"
    echo "Session: $session"
    echo "Phase: $phase"
    echo "Orchestrator: $(echo "$config" | jq -r '.orchestrator // "unknown"') (model: $(echo "$config" | jq -r '.model // "unknown"'))"
    echo ""
    echo -e "Findings:   $(echo "$stats" | jq '.findings_total')"
    echo -e "Validated:  $(echo "$stats" | jq '.findings_validated')"
    echo -e "Reported:   $(echo "$stats" | jq '.findings_reported')"
    echo ""

    if [[ -f "$PID_FILE" ]]; then
        pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo -e "${GREEN}Status: RUNNING (PID: $pid)${NC}"
            latest_log=$(ls -t "$LOGS_DIR"/orchestrator.log 2>/dev/null | head -1)
            if [[ -n "$latest_log" ]]; then
                echo -e "\nLatest activity:"
                tail -3 "$latest_log"
            fi
        else
            echo -e "${YELLOW}Status: STOPPED (stale PID)${NC}"
        fi
    else
        echo -e "${YELLOW}Status: IDLE${NC}"
    fi
    exit 0
fi

if [[ "$ACTION" == "stop" ]]; then
    if [[ ! -f "$PID_FILE" ]]; then
        echo -e "${RED}No running instance found${NC}"
        exit 1
    fi

    pid=$(cat "$PID_FILE")
    if ! ps -p "$pid" > /dev/null 2>&1; then
        echo -e "${YELLOW}PID $pid not running (stale)${NC}"
        rm -f "$PID_FILE"
        exit 1
    fi

    echo -e "${YELLOW}Stopping PID $pid...${NC}"
    kill "$pid" 2>/dev/null || true
    sleep 2

    if ps -p "$pid" > /dev/null 2>&1; then
        echo -e "${YELLOW}Force killing PID $pid${NC}"
        kill -9 "$pid" 2>/dev/null || true
    fi

    rm -f "$PID_FILE"
    echo -e "${GREEN}Stopped. Resume with: ./run.sh --target $TARGET --phase <phase>${NC}"
    exit 0
fi

# Handle background execution
if [[ "$BACKGROUND" == "true" ]]; then
    mkdir -p "$SCRIPT_DIR/.pids" "$SCRIPT_DIR/logs"

    # Check if already running
    if [[ -f "$PID_FILE" ]]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}Already running (PID: $OLD_PID)${NC}"
            exit 1
        fi
    fi

    # Launch in background with timestamped logs
    BG_LOG="$SCRIPT_DIR/logs/background_$(date +%Y%m%d_%H%M%S).log"

    # Reconstruct arguments (shift consumed $@)
    BG_ARGS="--target $TARGET --orchestrator $ORCHESTRATOR --model $MODEL --depth $DEPTH --focus $FOCUS"
    [[ "$FRESH" == "true" ]] && BG_ARGS="$BG_ARGS --fresh"
    [[ "$DEBUG" == "true" ]] && BG_ARGS="$BG_ARGS --debug"
    [[ -n "$START_PHASE" ]] && BG_ARGS="$BG_ARGS --phase $START_PHASE"

    # Launch and immediately save PID
    "$0" $BG_ARGS --no-background > "$BG_LOG" 2>&1 &
    BG_PID=$!
    echo "$BG_PID" > "$PID_FILE"

    echo -e "${GREEN}✓ Started in background (PID: $BG_PID)${NC}"
    echo ""
    echo "Commands:"
    echo "  View all output:  tail -f $BG_LOG"
    echo "  Session logs:     ls $SCRIPT_DIR/logs/vulnhunt-*/"
    echo "  Status:           ./run.sh --target $TARGET --status"
    echo "  Stop:             ./run.sh --target $TARGET --stop"
    echo ""
    echo "To debug failures, check: $BG_LOG"
    exit 0
fi

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

log() {
    local level="$1"
    local msg="$2"
    local color="$NC"
    case $level in
        INFO) color="$BLUE" ;;
        OK) color="$GREEN" ;;
        WARN) color="$YELLOW" ;;
        ERROR) color="$RED" ;;
    esac
    echo -e "${color}[$level]${NC} $(date '+%H:%M:%S') $msg"
    # Write to session-specific log if available
    if [[ -n "$SESSION_LOGS_DIR" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $msg" >> "$SESSION_LOGS_DIR/orchestrator.log"
    fi
}

ensure_dirs() {
    mkdir -p "$SCRIPT_DIR/state" "$BUILDS_DIR" "$SCRIPT_DIR/bugs/$TARGET_NAME" "$SCRIPT_DIR/.pids"
}

# Initialize logs directory based on session
init_session_logs() {
    local session_id="$1"
    SESSION_LOGS_DIR="$SCRIPT_DIR/logs/$session_id"
    mkdir -p "$SESSION_LOGS_DIR"
    # Legacy support - also set LOGS_DIR for compatibility
    LOGS_DIR="$SCRIPT_DIR/logs"
    mkdir -p "$LOGS_DIR"
}

# ============================================================================
# STATE MANAGEMENT
# ============================================================================

init_state() {
    local session_id="vulnhunt-$(date +%Y%m%d-%H%M%S)"
    cat > "$STATE_FILE" << EOF
{
  "meta": {
    "session_id": "$session_id",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "vulnhunter_version": "3.0"
  },
  "target": {
    "path": "$TARGET",
    "name": "$TARGET_NAME",
    "type": "library",
    "language": "C++",
    "build_system": "cmake"
  },
  "progress": {
    "phase": "init",
    "percent_complete": 0,
    "last_action": "State initialized",
    "next_action": "Build ASan library"
  },
  "config": {
    "orchestrator": "$ORCHESTRATOR",
    "model": "$MODEL",
    "depth": "$DEPTH",
    "focus": "$FOCUS",
    "max_retries": $MAX_RETRIES
  },
  "bugs_dir": "bugs/$TARGET_NAME/",
  "findings": [],
  "validated": [],
  "statistics": {
    "findings_total": 0,
    "findings_validated": 0,
    "findings_reported": 0
  }
}
EOF
    log "OK" "State initialized: $session_id"
}

get_phase() {
    jq -r '.progress.phase' "$STATE_FILE"
}

set_phase() {
    local phase="$1"
    local next_action="${2:-}"
    local tmp=$(mktemp)
    jq --arg p "$phase" --arg n "$next_action" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '.progress.phase = $p | .progress.next_action = $n | .meta.updated_at = $t' \
        "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
    log "INFO" "Phase: $phase"
}

add_finding() {
    local finding_json="$1"
    local tmp=$(mktemp)
    jq --argjson f "$finding_json" '.findings += [$f] | .statistics.findings_total += 1' \
        "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

mark_validated() {
    local finding_id="$1"
    local tmp=$(mktemp)
    jq --arg id "$finding_id" '.validated += [$id] | .statistics.findings_validated += 1' \
        "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# ============================================================================
# AGENT RUNNER (Claude or Codex Orchestrator)
# ============================================================================

# Run an agent template via claude --print
run_agent_claude() {
    local template="$1"
    local context="$2"
    local log_file="$3"

    local template_path="$AGENTS_DIR/$template"
    if [[ ! -f "$template_path" ]]; then
        log "ERROR" "Agent template not found: $template"
        return 1
    fi

    local prompt
    prompt="$(cat "$template_path")"$'\n\n'"$context"

    log "INFO" "Running via Claude ($MODEL): $template"

    # Run claude --print with prompt via stdin (avoids issues with --- frontmatter)
    local output
    if output=$(echo "$prompt" | claude --print --model "$MODEL" 2>&1); then
        echo "$output" >> "$log_file"

        # Check for refusal
        if echo "$output" | grep -qiE "(cannot assist|I'm sorry|I can't help)"; then
            log "WARN" "Agent refused, will retry with different framing"
            return 2  # Refusal code
        fi

        echo "$output"
        return 0
    else
        log "ERROR" "Claude command failed"
        echo "$output" >> "$log_file"
        return 1
    fi
}

# Run an agent template via Codex directly
run_agent_codex() {
    local template="$1"
    local context="$2"
    local log_file="$3"

    local template_path="$AGENTS_DIR/$template"
    if [[ ! -f "$template_path" ]]; then
        log "ERROR" "Agent template not found: $template"
        return 1
    fi

    local prompt
    prompt="$(cat "$template_path")"$'\n\n'"$context"

    log "INFO" "Running via Codex: $template"

    # Run codex directly via node companion
    local codex_companion="/Users/carlosgomez/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs"

    if [[ ! -f "$codex_companion" ]]; then
        log "ERROR" "Codex companion not found at $codex_companion"
        return 1
    fi

    # Debug: log the exact command being run
    if [[ "$DEBUG" == "true" ]]; then
        {
            echo "=== DEBUG: Codex Command ==="
            echo "Template: $template"
            echo "Prompt length: ${#prompt} chars"
            echo "Codex path: $codex_companion"
            echo "Command: node $codex_companion task --write \"<prompt>\""
            echo "==============================="
        } | tee -a "$log_file"
    fi

    # Run with tee to capture AND display output in real-time
    # Use unique temp file per process to avoid race conditions in parallel runs
    local tmp_output=$(mktemp /tmp/codex_output_$$.XXXXXX)
    local exit_code
    if node "$codex_companion" task --write "$prompt" 2>&1 | tee -a "$log_file" > "$tmp_output"; then
        exit_code=$?
        local output=$(cat "$tmp_output")

        # Debug: show raw output
        if [[ "$DEBUG" == "true" ]]; then
            {
                echo ""
                echo "=== DEBUG: Raw Codex Output ($(wc -l < "$tmp_output") lines) ==="
                head -50 "$tmp_output"
                if [[ $(wc -l < "$tmp_output") -gt 50 ]]; then
                    echo "... (truncated, see $log_file for full output) ..."
                fi
                echo "==============================="
                echo ""
            } | tee -a "$log_file"
        fi

        # Check for refusal
        if echo "$output" | grep -qiE "(cannot assist|I'm sorry|I can't help)"; then
            log "WARN" "Codex refused, will retry"
            cat "$tmp_output"
            rm -f "$tmp_output"
            return 2
        fi

        cat "$tmp_output"
        rm -f "$tmp_output"
        return 0
    else
        exit_code=$?
        log "ERROR" "Codex command failed (exit code: $exit_code)"
        if [[ "$DEBUG" == "true" ]]; then
            log "DEBUG" "Last 20 lines of output:"
            tail -20 "$tmp_output" | tee -a "$log_file"
        fi
        rm -f "$tmp_output"
        return 1
    fi
}

# Universal agent runner - dispatches to claude or codex
run_agent() {
    local template="$1"
    local context="$2"
    local log_file="${3:-}"

    # If no log file specified, create one in session logs
    if [[ -z "$log_file" ]]; then
        local agent_name=$(basename "$template" .md)
        log_file="$SESSION_LOGS_DIR/${agent_name}.log"
    fi

    if [[ "$ORCHESTRATOR" == "codex" ]]; then
        run_agent_codex "$template" "$context" "$log_file"
    else
        run_agent_claude "$template" "$context" "$log_file"
    fi
}

# Run agent with retry and reformulation
run_agent_with_retry() {
    local template="$1"
    local base_context="$2"
    local log_file="$3"

    local framings=(
        "You are a CODE QUALITY AUDITOR performing defensive programming review."
        "You are a COMPUTER SCIENCE RESEARCHER studying software reliability."
        "You are preparing FUZZ TEST TARGETS for OSS-Fuzz project."
        "You are a SENIOR ENGINEER doing code review before major release."
        "You are documenting ATTACK SURFACE for threat modeling."
        "Review this code. List functions with unchecked size parameters."
    )

    local accumulated_context=""
    local retry=0

    while [[ $retry -lt $MAX_RETRIES ]]; do
        local framing_idx=$((retry / 10 % ${#framings[@]}))
        local framing="${framings[$framing_idx]}"

        local context="$framing"$'\n\n'"$accumulated_context"$'\n\n'"$base_context"

        local result
        local exit_code
        result=$(run_agent "$template" "$context" "$log_file" "$retry") && exit_code=$? || exit_code=$?

        case $exit_code in
            0)  # Success
                echo "$result"
                return 0
                ;;
            2)  # Refusal - extract partial findings and retry
                # Extract any file:line references from partial output
                local partial=$(echo "$result" | grep -E '(file:|line:|function:|FINDING)' || true)
                if [[ -n "$partial" ]]; then
                    accumulated_context+=$'\n'"PREVIOUS PARTIAL FINDINGS:"$'\n'"$partial"
                fi
                log "WARN" "Retry $((retry + 1))/$MAX_RETRIES"
                ((retry++))
                ;;
            *)  # Error
                log "ERROR" "Agent failed with exit code $exit_code"
                ((retry++))
                ;;
        esac
    done

    log "ERROR" "Max retries ($MAX_RETRIES) reached for $template"
    return 1
}

# ============================================================================
# PHASE: BUILD
# ============================================================================

phase_build() {
    log "INFO" "=== PHASE: BUILD ==="

    local arch=$(uname -m)
    local build_dir="$BUILDS_DIR/${TARGET_NAME}-asan-${arch}"

    # Check if build already exists
    if [[ -f "$build_dir/compile_flags.txt" && -f "$build_dir/link_flags.txt" ]]; then
        log "OK" "Build exists: $build_dir"
        set_phase "discovery" "Run discovery agent"
        return 0
    fi

    log "INFO" "Creating ASan build..."

    local context="Target: $TARGET
Architecture: $arch
Output: $build_dir

TASK: Create ASan build for this target.
1. Detect build system (cmake/bazel/make)
2. Build with -fsanitize=address,undefined -g -O1
3. Copy .a files to $build_dir/lib/
4. Generate compile_flags.txt and link_flags.txt
5. Verify build works with test compilation"

    run_agent_with_retry "build-agent.md" "$context" "$SESSION_LOGS_DIR/build.log"

    # Verify build was created
    if [[ -f "$build_dir/compile_flags.txt" ]]; then
        log "OK" "Build complete: $build_dir"
        set_phase "discovery" "Run discovery agent"
    else
        log "ERROR" "Build failed - no compile_flags.txt"
        return 1
    fi
}

# ============================================================================
# PHASE: DISCOVERY
# ============================================================================

phase_discovery() {
    log "INFO" "=== PHASE: DISCOVERY ==="

    local results_file="$SCRIPT_DIR/state/discovery_results.json"
    local bugs_dir="$SCRIPT_DIR/bugs/$TARGET_NAME"

    # Build context - with --fresh, analyze from scratch (no skip)
    local skip_instruction=""
    if [[ "$FRESH" != "true" ]]; then
        skip_instruction="Skip known bugs in bugs/$TARGET_NAME/ directory."
    fi

    local context="Target: $TARGET
Focus: $FOCUS
Depth: $DEPTH
Output: $results_file

TASK: Find potential vulnerabilities in this codebase.
Focus on: signed/unsigned confusion, integer overflow, buffer overflows, unchecked sizes.
Save findings to JSON file with: id, title, severity, location (file, line, function), description.
$skip_instruction"

    run_agent_with_retry "discovery.md" "$context" "$SESSION_LOGS_DIR/discovery.log"

    # Parse results and deduplicate against existing bugs
    if [[ -f "$results_file" ]]; then
        local count=$(jq '.findings | length' "$results_file")
        log "OK" "Discovery found $count potential findings"

        # Deduplicate: compare with existing bugs in bugs/$TARGET_NAME/
        # NOTE: Use process substitution to avoid subshell (preserves counters)
        local new_count=0
        local rediscovered_count=0

        while read -r finding; do
            local fid=$(echo "$finding" | jq -r '.id')
            local ffile=$(echo "$finding" | jq -r '.location.file // ""')
            local fline=$(echo "$finding" | jq -r '.location.line // 0')
            local ffunc=$(echo "$finding" | jq -r '.location.function // ""')

            # Check if this finding matches an existing bug
            local is_duplicate=false

            if [[ -d "$bugs_dir" ]]; then
                for bug_dir in "$bugs_dir"/*/; do
                    [[ -d "$bug_dir" ]] || continue
                    local report_file="$bug_dir/REPORT.md"
                    local status_file="$bug_dir/VALIDATION_STATUS.md"

                    # Check if same file:line exists in existing bug
                    if [[ -f "$report_file" ]]; then
                        if grep -q "$ffile" "$report_file" 2>/dev/null && \
                           grep -q ":$fline" "$report_file" 2>/dev/null; then
                            is_duplicate=true
                            log "INFO" "Rediscovered: $fid matches $(basename "$bug_dir") - already validated"
                            ((rediscovered_count++)) || true
                            break
                        fi
                    fi
                done
            fi

            if [[ "$is_duplicate" == "false" ]]; then
                add_finding "$finding"
                ((new_count++)) || true
            fi
        done < <(jq -c '.findings[]' "$results_file")

        log "OK" "Deduplication: $new_count new, $rediscovered_count rediscovered (skipped)"

        # Check actual new findings in state
        local state_findings=$(jq '.findings | length' "$STATE_FILE")
        if [[ $state_findings -gt 0 ]]; then
            set_phase "validation" "Validate findings with ASan"
        else
            log "WARN" "No new findings after deduplication - skipping to reporting"
            set_phase "reporting" "Generate final report"
        fi
    else
        log "WARN" "No discovery results file"
        set_phase "reporting" "Generate final report"
    fi
}

# ============================================================================
# PHASE: VALIDATION
# ============================================================================

phase_validation() {
    log "INFO" "=== PHASE: MULTI-STRATEGY VALIDATION ==="

    local arch=$(uname -m)
    local build_dir="$BUILDS_DIR/${TARGET_NAME}-asan-${arch}"
    local findings_count=$(jq '.findings | length' "$STATE_FILE")

    if [[ $findings_count -eq 0 ]]; then
        log "WARN" "No findings to validate"
        set_phase "chain" "Research exploit chains"
        return 0
    fi

    log "INFO" "Validating $findings_count findings with 4-validator consensus (parallel: $PARALLEL_VALIDATORS)"
    log "INFO" "Validators: ASan + LLDB + Fresh + Impact"

    # =========================================================================
    # VALIDATOR 1: ASan (memory corruption detection)
    # =========================================================================
    log "INFO" "Validator 1/4: ASan (memory corruption)..."
    local pids=()

    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')
        local bug_dir="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid"
        mkdir -p "$bug_dir/validation" "$bug_dir/poc"

        log "INFO" "  ASan: $fid"

        # Different context for revalidate vs normal validation
        local asan_context
        if [[ "$REVALIDATE" == "true" ]]; then
            asan_context="Finding ID: $fid
Bug Directory: $bug_dir
Build Directory: $build_dir
Target Source: $TARGET
Compile Flags: $(cat "$build_dir/compile_flags.txt" 2>/dev/null || echo "N/A")
Link Flags: $(cat "$build_dir/link_flags.txt" 2>/dev/null || echo "N/A")

MODE: REVALIDATION - Create fresh POC from source analysis (do NOT use existing POCs)

STEP 0 - ANALYZE SOURCE:
The finding name '$fid' indicates what to look for.
Search the target source code for the vulnerability:
  rg -n '$fid' $TARGET --type cpp | head -20
  rg -n '$(echo $fid | tr '_-' '|')' $TARGET --type cpp | head -30
Understand the bug from source, then create a minimal POC.

STEP 1 - CREATE FRESH POC:
Based on source analysis, write a new poc_real.cpp that triggers the bug.
Save to: $bug_dir/poc/poc_real.cpp

STEP 2 - COMPILE:
Use xcrun clang++ -arch arm64 if homebrew clang fails.
Add missing libs as needed (-labsl_cord, -lz, etc).

STEP 3 - RUN:
ASAN_OPTIONS=detect_leaks=0 ./poc_binary 2>&1

STEP 4 - SAVE RESULT:
Save to $bug_dir/validation/asan_result.json:
{\"validator\": \"asan\", \"status\": \"CONFIRMED_MEMORY|LOGIC_BUG|NO_CRASH|SOURCE_NOT_FOUND\", \"evidence\": \"...\"}

Status meanings:
- CONFIRMED_MEMORY: ASan detected memory corruption
- LOGIC_BUG: No crash but incorrect behavior demonstrated
- NO_CRASH: Code handled input safely
- SOURCE_NOT_FOUND: Could not locate vulnerable code in source"
        else
            asan_context="Finding: $finding
Bug Directory: $bug_dir
Build Directory: $build_dir
Compile Flags: $(cat "$build_dir/compile_flags.txt" 2>/dev/null || echo "N/A")
Link Flags: $(cat "$build_dir/link_flags.txt" 2>/dev/null || echo "N/A")

TASK: Validate this finding against the REAL compiled library.

STEP 0 - CHECK FOR EXISTING POC:
First, check if POC already exists:
  ls -la $bug_dir/poc/
  cat $bug_dir/poc/*.cpp 2>/dev/null || cat $bug_dir/poc/*.cc 2>/dev/null
If POC exists, use it. If not, create one based on finding info.

STEP 1 - COMPILE:
Use xcrun clang++ -arch arm64 if homebrew clang fails.
Add missing libs as needed (-labsl_cord, -lz, etc).

STEP 2 - RUN:
ASAN_OPTIONS=detect_leaks=0 ./poc_binary 2>&1

STEP 3 - SAVE RESULT:
Save to $bug_dir/validation/asan_result.json:
{\"validator\": \"asan\", \"status\": \"CONFIRMED_MEMORY|LOGIC_BUG|NO_CRASH\", \"evidence\": \"...\"}

Status meanings:
- CONFIRMED_MEMORY: ASan detected memory corruption (crash)
- LOGIC_BUG: No crash but demonstrates incorrect behavior
- NO_CRASH: Code handled input without issues"
        fi

        # Run in background with slot management
        if [[ ${#pids[@]} -lt $PARALLEL_VALIDATORS ]]; then
            ( run_agent_with_retry "asan-validator.md" "$asan_context" "$SESSION_LOGS_DIR/asan_$fid.log" ) &
            pids+=($!)
        else
            wait -n "${pids[@]}" 2>/dev/null || true
            local new_pids=()
            for pid in "${pids[@]}"; do
                kill -0 "$pid" 2>/dev/null && new_pids+=("$pid")
            done
            pids=("${new_pids[@]}")
            ( run_agent_with_retry "asan-validator.md" "$asan_context" "$SESSION_LOGS_DIR/asan_$fid.log" ) &
            pids+=($!)
        fi
    done < <(jq -c '.findings[]' "$STATE_FILE")

    wait "${pids[@]}" 2>/dev/null || true
    log "OK" "ASan validators finished"

    # =========================================================================
    # VALIDATOR 2: LLDB (state inspection)
    # =========================================================================
    log "INFO" "Validator 2/4: LLDB (state inspection)..."
    pids=()

    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')
        local bug_dir="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid"
        mkdir -p "$bug_dir/debugging"

        log "INFO" "  LLDB: $fid"

        local rosetta_note=""
        if [[ "$ROSETTA_MODE" == "true" ]]; then
            rosetta_note="
ROSETTA MODE DETECTED: This process runs under x86_64 translation on ARM64 Mac.
LLDB and GDB CANNOT debug ARM64 binaries from this environment.
YOU MUST USE PRINTF STATE CAPTURE DIRECTLY - do NOT attempt LLDB or GDB.
"
        fi

        local lldb_context="Finding: $finding
Build Directory: $build_dir
Bug Directory: $bug_dir
PoC Source: $bug_dir/poc/poc_real.cpp (if exists)
$rosetta_note
TASK: Capture runtime state evidence for this finding.

STEP 0 - CHECK ROSETTA:
Run: sysctl -n sysctl.proc_translated 2>/dev/null
If returns '1' → USE PRINTF FALLBACK DIRECTLY (skip LLDB/GDB entirely)

STEP 1 - STATE CAPTURE:
If Rosetta: Add fprintf() statements to PoC to print variable states
If Native: Use LLDB with breakpoints

STEP 2 - COMPILE AND RUN:
Compile PoC with debug symbols (-g)
Run and capture output showing internal state

STEP 3 - DOCUMENT:
Save commands to $bug_dir/debugging/lldb_commands.txt (or printf_capture.txt)
Save report to $bug_dir/debugging/LLDB_DEBUG_REPORT.md
Save result to $bug_dir/validation/lldb_result.json:
{\"validator\": \"lldb\", \"status\": \"STATE_BUG|STATE_OK\", \"evidence\": \"...\", \"method\": \"lldb|gdb|printf\"}

Status meanings:
- STATE_BUG: Incorrect state observed (negative size, wrong limit, overflow)
- STATE_OK: State appears correct"

        # Run in background with slot management
        if [[ ${#pids[@]} -lt $PARALLEL_VALIDATORS ]]; then
            ( run_agent_with_retry "lldb-debugger.md" "$lldb_context" "$SESSION_LOGS_DIR/lldb_$fid.log" ) &
            pids+=($!)
        else
            wait -n "${pids[@]}" 2>/dev/null || true
            local new_pids=()
            for pid in "${pids[@]}"; do
                kill -0 "$pid" 2>/dev/null && new_pids+=("$pid")
            done
            pids=("${new_pids[@]}")
            ( run_agent_with_retry "lldb-debugger.md" "$lldb_context" "$SESSION_LOGS_DIR/lldb_$fid.log" ) &
            pids+=($!)
        fi
    done < <(jq -c '.findings[]' "$STATE_FILE")

    wait "${pids[@]}" 2>/dev/null || true
    log "OK" "LLDB validators finished"

    # =========================================================================
    # VALIDATOR 3: Fresh (independent analysis, no prior knowledge)
    # =========================================================================
    log "INFO" "Validator 3/4: Fresh (independent review, no context)..."
    pids=()

    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')
        local bug_dir="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid"
        local ffile=$(echo "$finding" | jq -r '.location.file // ""')
        local fline=$(echo "$finding" | jq -r '.location.line // 0')
        local ffunc=$(echo "$finding" | jq -r '.location.function // ""')

        log "INFO" "  Fresh: $fid (blind review)"

        # CRITICAL: Fresh validator gets ONLY location, NOT the bug description
        local fresh_context="Repository: $TARGET
File: $ffile
Line Range: $((fline - 20)) to $((fline + 20))
Function: $ffunc

TASK: Independent code review WITHOUT knowing what was reported.
1. Read the code at the specified location
2. Analyze for ANY potential issues (integer handling, bounds, validation, etc.)
3. Document what you find objectively
4. Save result to $bug_dir/validation/fresh_result.json with format:
   {\"validator\": \"fresh\", \"status\": \"FOUND|FOUND_DIFFERENT|NOT_FOUND\", \"findings\": [...]}
5. Status meanings:
   - FOUND: Found an issue at/near the specified location
   - FOUND_DIFFERENT: Found different issue than expected location
   - NOT_FOUND: No issues identified
6. BE OBJECTIVE - don't assume there's a bug, analyze the code fresh"

        # Run in background with slot management
        if [[ ${#pids[@]} -lt $PARALLEL_VALIDATORS ]]; then
            ( run_agent_with_retry "fresh-validator.md" "$fresh_context" "$SESSION_LOGS_DIR/fresh_$fid.log" ) &
            pids+=($!)
        else
            wait -n "${pids[@]}" 2>/dev/null || true
            local new_pids=()
            for pid in "${pids[@]}"; do
                kill -0 "$pid" 2>/dev/null && new_pids+=("$pid")
            done
            pids=("${new_pids[@]}")
            ( run_agent_with_retry "fresh-validator.md" "$fresh_context" "$SESSION_LOGS_DIR/fresh_$fid.log" ) &
            pids+=($!)
        fi
    done < <(jq -c '.findings[]' "$STATE_FILE")

    wait "${pids[@]}" 2>/dev/null || true
    log "OK" "Fresh validators finished"

    # =========================================================================
    # VALIDATOR 4: Impact (practical consequences)
    # =========================================================================
    log "INFO" "Validator 4/4: Impact (practical demonstration)..."
    pids=()

    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')
        local bug_dir="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid"

        log "INFO" "  Impact: $fid"

        local impact_context="Finding: $finding
Repository: $TARGET
Build Directory: $build_dir
Bug Directory: $bug_dir
Previous Results:
- ASan: $bug_dir/validation/asan_result.json
- LLDB: $bug_dir/validation/lldb_result.json
- Fresh: $bug_dir/validation/fresh_result.json

TASK: Demonstrate practical consequences of this issue.
1. Read previous validator results
2. Identify entry points (public APIs that reach this code)
3. Create demonstration showing real-world impact
4. Document consequences (service disruption, incorrect processing, etc.)
5. Save result to $bug_dir/validation/impact_result.json with format:
   {\"validator\": \"impact\", \"status\": \"DEMONSTRATED|LIMITED_IMPACT|NO_PRACTICAL_IMPACT\",
    \"entry_points\": [...], \"consequences\": [...]}
6. Status meanings:
   - DEMONSTRATED: Practical impact proven through real API
   - LIMITED_IMPACT: Impact exists but constrained
   - NO_PRACTICAL_IMPACT: Bug exists but no real consequence"

        # Run in background with slot management
        if [[ ${#pids[@]} -lt $PARALLEL_VALIDATORS ]]; then
            ( run_agent_with_retry "impact-validator.md" "$impact_context" "$SESSION_LOGS_DIR/impact_$fid.log" ) &
            pids+=($!)
        else
            wait -n "${pids[@]}" 2>/dev/null || true
            local new_pids=()
            for pid in "${pids[@]}"; do
                kill -0 "$pid" 2>/dev/null && new_pids+=("$pid")
            done
            pids=("${new_pids[@]}")
            ( run_agent_with_retry "impact-validator.md" "$impact_context" "$SESSION_LOGS_DIR/impact_$fid.log" ) &
            pids+=($!)
        fi
    done < <(jq -c '.findings[]' "$STATE_FILE")

    wait "${pids[@]}" 2>/dev/null || true
    log "OK" "Impact validators finished"

    # =========================================================================
    # CONSENSUS ANALYSIS
    # =========================================================================
    log "INFO" "Running consensus analysis..."

    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')
        local bug_dir="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid"
        mkdir -p "$bug_dir/consensus"

        local consensus_context="Finding: $finding
Bug Directory: $bug_dir
Validator Results:
- ASan: $bug_dir/validation/asan_result.json
- LLDB: $bug_dir/validation/lldb_result.json
- Fresh: $bug_dir/validation/fresh_result.json
- Impact: $bug_dir/validation/impact_result.json

TASK: Analyze all validator results and determine consensus.
1. Read all validator results
2. Calculate confidence score based on agreement
3. Generate consensus report
4. Save to $bug_dir/consensus/confidence_score.json and CONSENSUS_REPORT.md
5. Scoring:
   - ASan CONFIRMED_MEMORY: +1.0, LOGIC_BUG: +0.7, NO_CRASH: -0.3
   - LLDB STATE_BUG: +0.9, STATE_OK: -0.3
   - Fresh FOUND: +1.0, FOUND_DIFFERENT: +0.8, NOT_FOUND: -0.5
   - Impact DEMONSTRATED: +0.8, LIMITED_IMPACT: +0.4, NO_PRACTICAL_IMPACT: -0.2
6. Confidence levels: >=3.0 CONFIRMED_HIGH, 2.0-2.9 CONFIRMED, 1.0-1.9 LIKELY, <1.0 UNCERTAIN"

        run_agent_with_retry "consensus-analyzer.md" "$consensus_context" "$SESSION_LOGS_DIR/consensus_$fid.log"
    done < <(jq -c '.findings[]' "$STATE_FILE")

    log "OK" "Consensus analysis finished"

    # =========================================================================
    # COLLECT FINAL RESULTS
    # =========================================================================
    log "INFO" "Collecting final validation results..."
    local confirmed_high=0
    local confirmed=0
    local likely=0
    local uncertain=0

    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')
        local consensus_file="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid/consensus/confidence_score.json"

        if [[ -f "$consensus_file" ]]; then
            local level=$(jq -r '.confidence_level // "UNCERTAIN"' "$consensus_file")
            case "$level" in
                CONFIRMED_HIGH)
                    ((confirmed_high++)) || true
                    mark_validated "$fid"
                    ;;
                CONFIRMED)
                    ((confirmed++)) || true
                    mark_validated "$fid"
                    ;;
                LIKELY)
                    ((likely++)) || true
                    ;;
                *)
                    ((uncertain++)) || true
                    ;;
            esac
        else
            ((uncertain++)) || true
        fi
    done < <(jq -c '.findings[]' "$STATE_FILE")

    log "OK" "Validation complete (4-validator consensus):"
    log "INFO" "  CONFIRMED_HIGH: $confirmed_high"
    log "INFO" "  CONFIRMED: $confirmed"
    log "INFO" "  LIKELY: $likely"
    log "INFO" "  UNCERTAIN: $uncertain"

    # =========================================================================
    # POST-CONFIRMATION ANALYSIS (only for confirmed findings)
    # =========================================================================
    local total_confirmed=$((confirmed_high + confirmed))
    if [[ $total_confirmed -gt 0 ]]; then
        log "INFO" "Running post-confirmation analysis for $total_confirmed confirmed findings..."

        while read -r finding; do
            local fid=$(echo "$finding" | jq -r '.id')
            local consensus_file="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid/consensus/confidence_score.json"

            if [[ -f "$consensus_file" ]]; then
                local level=$(jq -r '.confidence_level // "UNCERTAIN"' "$consensus_file")
                if [[ "$level" == "CONFIRMED_HIGH" || "$level" == "CONFIRMED" ]]; then
                    local bug_dir="$SCRIPT_DIR/bugs/$TARGET_NAME/$fid"
                    mkdir -p "$bug_dir/analysis"

                    log "INFO" "  Post-analysis: $fid"

                    local post_context="Finding: $finding
Repository: $TARGET
Bug Directory: $bug_dir
Consensus: $bug_dir/consensus/confidence_score.json

TASK: Deep analysis of this confirmed issue.
1. Map all entry points (public APIs that reach vulnerable code)
2. Analyze consequences in detail
3. Find related code patterns that might have similar issues
4. Save to $bug_dir/analysis/:
   - entry_points.md
   - consequences.md
   - related_issues.md
   - POST_CONFIRMATION_ANALYSIS.md"

                    run_agent_with_retry "post-confirmation-analyzer.md" "$post_context" "$SESSION_LOGS_DIR/post_$fid.log"
                fi
            fi
        done < <(jq -c '.findings[]' "$STATE_FILE")

        log "OK" "Post-confirmation analysis finished"
    fi

    set_phase "chain" "Research exploit chains"
}


# ============================================================================
# PHASE: CHAIN RESEARCH
# ============================================================================

phase_chain() {
    log "INFO" "=== PHASE: CHAIN RESEARCH ==="

    local validated=$(jq -r '.validated[]' "$STATE_FILE" 2>/dev/null | wc -l | tr -d ' ')

    if [[ $validated -eq 0 ]]; then
        log "WARN" "No validated findings for chain research"
        set_phase "impact" "Calculate CVSS"
        return 0
    fi

    # NOTE: Iterate over validated IDs directly, then fetch finding details
    while read -r fid; do
        [[ -z "$fid" ]] && continue

        # Get finding details from state
        local finding=$(jq -c --arg id "$fid" '.findings[] | select(.id == $id)' "$STATE_FILE" 2>/dev/null)
        [[ -z "$finding" ]] && continue

        local context="Validated Vulnerability: $finding
Codebase: $TARGET

TASK: Research exploit potential.
1. Can this be escalated to RCE?
2. What adjacent memory can be corrupted?
3. Can this bypass ASLR for another bug?
4. Search for prior art (CVEs, blog posts)
5. Document chain possibilities"

        run_agent_with_retry "chain-researcher.md" "$context" "$SESSION_LOGS_DIR/chain_$fid.log"
    done < <(jq -r '.validated[]' "$STATE_FILE" 2>/dev/null)

    set_phase "impact" "Calculate CVSS"
}

# ============================================================================
# PHASE: IMPACT ANALYSIS
# ============================================================================

phase_impact() {
    log "INFO" "=== PHASE: IMPACT ANALYSIS ==="

    local context="State: $(cat "$STATE_FILE")

TASK: Calculate CVSS scores for all validated findings.
Consider: attack vector, complexity, privileges, user interaction, scope, CIA impact.
Update findings with CVSS scores and severity ratings."

    run_agent_with_retry "impact-analyst.md" "$context" "$SESSION_LOGS_DIR/impact.log"

    set_phase "reporting" "Generate VRP reports"
}

# ============================================================================
# PHASE: REPORTING
# ============================================================================

phase_reporting() {
    log "INFO" "=== PHASE: REPORTING ==="

    local validated=$(jq -r '.validated[]' "$STATE_FILE" 2>/dev/null | wc -l | tr -d ' ')

    if [[ $validated -eq 0 ]]; then
        log "WARN" "No validated findings to report"
        set_phase "done" "Complete"
        return 0
    fi

    # Generate VRP report for all validated
    local context="State: $(cat "$STATE_FILE")
Bugs Directory: $SCRIPT_DIR/bugs/$TARGET_NAME/

TASK: Generate VRP-quality reports for all validated findings.
Include: title, summary, reproduction steps, impact, CVSS, proof (ASan output).
Save to bugs/$TARGET_NAME/<bug-name>/REPORT.md"

    run_agent_with_retry "vrp-reporter.md" "$context" "$SESSION_LOGS_DIR/vrp_report.log"

    # Generate explainer for HIGH/CRITICAL
    # NOTE: Use process substitution to avoid subshell
    while read -r finding; do
        local fid=$(echo "$finding" | jq -r '.id')

        local context="Finding: $finding

TASK: Generate non-technical explanation for this vulnerability.
Target audience: managers, executives, non-security stakeholders."

        run_agent_with_retry "explainer-reporter.md" "$context" "$SESSION_LOGS_DIR/explainer_$fid.log"
    done < <(jq -c '.findings[] | select(.severity == "HIGH" or .severity == "CRITICAL")' "$STATE_FILE")

    set_phase "done" "Complete"
}

# ============================================================================
# PHASE: DONE
# ============================================================================

phase_done() {
    log "OK" "=== VULNHUNTER COMPLETE ==="

    local stats=$(jq '.statistics' "$STATE_FILE")
    local total=$(echo "$stats" | jq '.findings_total')
    local validated=$(echo "$stats" | jq '.findings_validated')
    local reported=$(echo "$stats" | jq '.findings_reported')

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         VULNHUNTER SUMMARY             ║${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} Target:     $TARGET_NAME"
    echo -e "${GREEN}║${NC} Findings:   $total discovered"
    echo -e "${GREEN}║${NC} Validated:  $validated confirmed"
    echo -e "${GREEN}║${NC} Reports:    $SCRIPT_DIR/bugs/$TARGET_NAME/"
    echo -e "${GREEN}║${NC} Logs:       $LOGS_DIR/"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
}

# ============================================================================
# STATUS AND CONTROL
# ============================================================================

# ============================================================================
# MAIN ORCHESTRATION LOOP
# ============================================================================

main() {
    ensure_dirs

    log "INFO" "VulnHunter v3 - Shell Orchestrator"
    log "INFO" "Target: $TARGET"
    log "INFO" "Orchestrator: $ORCHESTRATOR $([ "$ORCHESTRATOR" = "claude" ] && echo "($MODEL)" || echo "(direct)")"
    log "INFO" "Depth: $DEPTH | Focus: $FOCUS"
    if [[ "$DEBUG" == "true" ]]; then
        log "INFO" "DEBUG MODE ENABLED - full output + commands logged"
        set -x  # Enable bash debugging
    fi

    # Initialize or load state
    if [[ "$FRESH" == "true" ]] || [[ ! -f "$STATE_FILE" ]]; then
        init_state
    else
        log "INFO" "Resuming session: $(jq -r '.meta.session_id' "$STATE_FILE")"
        # Load orchestrator and model from saved state (unless overridden)
        local saved_orch=$(jq -r '.config.orchestrator // "claude"' "$STATE_FILE")
        local saved_model=$(jq -r '.config.model // "haiku"' "$STATE_FILE")
        if [[ "$ORCHESTRATOR" == "claude" && "$MODEL" == "claude-haiku-4-5-20251001" ]]; then
            # Using defaults - load from state
            ORCHESTRATOR="$saved_orch"
            MODEL="$saved_model"
        fi
    fi

    # Handle --revalidate: scan bugs/ directory and re-validate all findings
    if [[ "$REVALIDATE" == "true" ]]; then
        log "INFO" "=== REVALIDATION MODE ==="
        log "INFO" "Scanning bugs/$TARGET_NAME/ for existing findings..."

        local bugs_dir="$SCRIPT_DIR/bugs/$TARGET_NAME"
        if [[ ! -d "$bugs_dir" ]]; then
            log "ERROR" "No bugs directory found: $bugs_dir"
            exit 1
        fi

        # Build findings array from bugs/ directory
        local findings_json="["
        local first=true
        local count=0

        for dir in "$bugs_dir"/*/; do
            local name=$(basename "$dir")
            [[ "$name" == "." ]] && continue
            [[ ! -d "$dir" ]] && continue

            # Clear existing validation directory
            if [[ -d "${dir}validation" ]]; then
                log "INFO" "  Clearing validation for: $name"
                rm -rf "${dir}validation"
            fi
            mkdir -p "${dir}validation"

            # Backup and clear existing POC directory (revalidate = fresh POCs)
            if [[ -d "${dir}poc" ]]; then
                log "INFO" "  Backing up old POC for: $name"
                mv "${dir}poc" "${dir}poc_backup_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
            fi
            mkdir -p "${dir}poc"

            # Clear debugging directory too
            if [[ -d "${dir}debugging" ]]; then
                rm -rf "${dir}debugging"
            fi
            mkdir -p "${dir}debugging"

            $first || findings_json+=","
            first=false
            ((count++))

            # Create finding entry
            findings_json+="{\"id\": \"$name\", \"title\": \"$name\", \"severity\": \"MEDIUM\", "
            findings_json+="\"location\": {\"file\": \"bugs/$TARGET_NAME/$name/poc/\", \"line\": 0, \"function\": \"$name\"}, "
            findings_json+="\"status\": \"pending_validation\", \"revalidate\": true}"
        done

        findings_json+="]"

        # Update state
        jq --argjson findings "$findings_json" '
            .findings = $findings |
            .validated = [] |
            .progress.phase = "validation" |
            .progress.last_action = "Revalidation started" |
            .statistics.findings_total = ($findings | length) |
            .statistics.findings_validated = 0
        ' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"

        log "OK" "Loaded $count findings for revalidation"
        set_phase "validation" "Revalidation mode - skipping to validation"
    fi

    # Initialize session-specific logs directory
    local session_id=$(jq -r '.meta.session_id' "$STATE_FILE")
    init_session_logs "$session_id"
    log "INFO" "Session logs: $SESSION_LOGS_DIR"

    # Override phase if specified
    if [[ -n "$START_PHASE" ]]; then
        set_phase "$START_PHASE" "Manual phase override"
    fi

    # Main state machine loop
    while true; do
        local phase=$(get_phase)

        case $phase in
            init)
                set_phase "build" "Create ASan build"
                ;;
            build)
                phase_build
                ;;
            discovery)
                phase_discovery
                ;;
            validation)
                phase_validation
                ;;
            chain)
                phase_chain
                ;;
            impact)
                phase_impact
                ;;
            reporting)
                phase_reporting
                ;;
            done)
                phase_done
                break
                ;;
            *)
                log "ERROR" "Unknown phase: $phase"
                exit 1
                ;;
        esac
    done
}

# Trap for clean shutdown
trap 'log "WARN" "Interrupted - state saved"; exit 130' INT TERM

# Run
main
