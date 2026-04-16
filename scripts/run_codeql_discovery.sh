#!/usr/bin/env bash
set -u

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
TARGET="$ROOT/targets/protobuf"
DB="$ROOT/state/codeql_db"
RESULTS_DIR="$ROOT/state/codeql_results"
CURRENT_RUN_DIR="$ROOT/state/current_run"
FINDINGS_JSON="$RESULTS_DIR/codeql_findings.json"
CURRENT_FINDINGS_JSON="$CURRENT_RUN_DIR/codeql_findings.json"
LOG_FILE="$RESULTS_DIR/codeql_discovery_run.log"
ERR_LOG="$RESULTS_DIR/codeql_discovery_errors.log"

mkdir -p "$RESULTS_DIR" "$CURRENT_RUN_DIR"
: > "$LOG_FILE"
: > "$ERR_LOG"

log() {
  printf '%s %s\n' "[$(date '+%Y-%m-%d %H:%M:%S')]" "$*" | tee -a "$LOG_FILE"
}

log_err() {
  printf '%s %s\n' "[$(date '+%Y-%m-%d %H:%M:%S')]" "$*" | tee -a "$LOG_FILE" >> "$ERR_LOG"
}

run_step() {
  local name="$1"
  shift
  log "START $name"
  if "$@" >>"$LOG_FILE" 2>>"$ERR_LOG"; then
    log "OK $name"
    return 0
  fi
  local rc=$?
  log_err "FAIL $name (exit $rc)"
  return $rc
}

step1_codeql_version() {
  codeql version
}

step2_create_db() {
  if [ -d "$DB" ]; then
    log "Database already exists at $DB, skipping creation"
    return 0
  fi

  if codeql database create "$DB" --language=cpp --source-root="$TARGET" --overwrite >>"$LOG_FILE" 2>>"$ERR_LOG"; then
    return 0
  fi

  log_err "DB creation failed, trying with build command"

  cd "$TARGET" || return 1

  if [ -f CMakeLists.txt ]; then
    codeql database create "$DB" --language=cpp --source-root="$TARGET" --command="cmake -B build-codeql && cmake --build build-codeql" --overwrite
    return $?
  fi

  if [ -f Makefile ]; then
    codeql database create "$DB" --language=cpp --source-root="$TARGET" --command="make" --overwrite
    return $?
  fi

  log_err "No CMakeLists.txt or Makefile found for fallback build"
  return 1
}

step3_security_queries() {
  mkdir -p "$RESULTS_DIR"
  codeql database analyze "$DB" codeql/cpp-queries:codeql-suites/cpp-security-extended.qls --format=sarif-latest --output="$RESULTS_DIR/security.sarif"
}

step4_learned_queries() {
  local found=0
  local q
  shopt -s nullglob
  for q in "$ROOT"/learned/queries/active/*.ql; do
    found=1
    local base
    base="$(basename "$q" .ql)"
    log "Analyzing learned query $q"
    if ! codeql database analyze "$DB" "$q" --format=sarif-latest --output="$RESULTS_DIR/${base}.sarif" >>"$LOG_FILE" 2>>"$ERR_LOG"; then
      log_err "Learned query failed: $q"
    fi
  done
  shopt -u nullglob

  if [ "$found" -eq 0 ]; then
    log "No learned queries found in learned/queries/active"
  fi
}

step5_parse_sarif() {
  local tmp_json
  tmp_json="$(mktemp)"
  if ! jq -n '{findings: []}' >"$tmp_json"; then
    log_err "Failed to initialize findings JSON"
    rm -f "$tmp_json"
    return 1
  fi

  local sarif
  local idx=1
  shopt -s nullglob
  for sarif in "$RESULTS_DIR"/*.sarif; do
    if ! jq --arg sarif "$sarif" --argjson start "$idx" '
      def pad3:
        tostring as $s
        | if ($s|length) == 1 then "00" + $s
          elif ($s|length) == 2 then "0" + $s
          else $s
          end;
      def mkid($n): "cql-" + ($n | pad3);
      def res:
        .runs[]?.results[]? as $r
        | {
            rule: ($r.ruleId // ""),
            file: (($r.locations[0]?.physicalLocation?.artifactLocation?.uri // "")),
            line: ($r.locations[0]?.physicalLocation?.region?.startLine // 0),
            message: ($r.message.text // $r.message.markdown // "")
          };
      [res] as $items
      | {
          findings: [
            range(0; $items|length) as $i
            | $items[$i] + {id: mkid($start + $i)}
          ],
          count: ($items|length)
        }
    ' "$sarif" >"$tmp_json.parse"; then
      log_err "Failed to parse SARIF: $sarif"
      continue
    fi

    if ! jq -s '.[0].findings += .[1].findings | .[0]' "$tmp_json" "$tmp_json.parse" >"$tmp_json.merge"; then
      log_err "Failed to merge parsed findings for: $sarif"
      continue
    fi

    mv "$tmp_json.merge" "$tmp_json"
    idx="$(jq '.count + 0' "$tmp_json.parse" 2>/dev/null | awk -v cur="$idx" '{print cur + $1}')"
    rm -f "$tmp_json.parse"
  done
  shopt -u nullglob

  mv "$tmp_json" "$FINDINGS_JSON"
  cp "$FINDINGS_JSON" "$CURRENT_FINDINGS_JSON"
  log "Wrote findings JSON to $FINDINGS_JSON and $CURRENT_FINDINGS_JSON"
}

log "=== Environment Detection ==="
log "OS: $(uname -s), Arch: $(uname -m)"
log "Rosetta: $(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)"
log "Clang: $(which clang++ 2>/dev/null || echo NOT_FOUND)"
log "LLDB: $(which lldb 2>/dev/null || echo NOT_FOUND)"

run_step "STEP 1 - Check CodeQL" step1_codeql_version || true
run_step "STEP 2 - Create database" step2_create_db || true
run_step "STEP 3 - Run security queries" step3_security_queries || true
run_step "STEP 4 - Run learned queries" step4_learned_queries || true
run_step "STEP 5 - Parse SARIF results into findings JSON" step5_parse_sarif || true

log "Completed CodeQL discovery run"
