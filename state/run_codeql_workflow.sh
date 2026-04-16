#!/usr/bin/env bash
set +e

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
DB="$ROOT/state/codeql_db"
RESULTS="$ROOT/state/codeql_results"
CURRENT="$ROOT/state/current_run"
TARGET="$ROOT/targets/protobuf"
LOG="$RESULTS/codeql_execution.log"

mkdir -p "$RESULTS" "$CURRENT"
: > "$LOG"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

run_cmd() {
  local step="$1"
  shift
  log "START $step: $*"
  "$@" 2>&1 | tee -a "$LOG"
  local status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then
    log "ERROR $step exit=$status"
  else
    log "OK $step"
  fi
  return "$status"
}

log "=== Environment Detection ==="
OS=$(uname -s)
ARCH=$(uname -m)
log "OS: $OS, Arch: $ARCH"
if [ "$OS" = "Darwin" ]; then
  ROSETTA=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo "0")
  if [ "$ROSETTA" = "1" ]; then
    log "Rosetta: YES"
  else
    log "Rosetta: NO"
  fi
fi
log "Clang: $(command -v clang++ 2>/dev/null || echo NOT_FOUND)"
log "LLDB: $(command -v lldb 2>/dev/null || echo NOT_FOUND)"

run_cmd "STEP 1 - Check CodeQL" codeql version

ensure_database_ready() {
  if [ -d "$DB" ] && find "$DB" -mindepth 1 -maxdepth 1 | read; then
    run_cmd "STEP 2F - Finalize existing database" codeql database finalize "$DB"
    if [ $? -eq 0 ]; then
      return 0
    fi
    log "Existing database is invalid; recreating with build command"
  fi

  rm -rf "$DB"
    if [ -f "$TARGET/CMakeLists.txt" ]; then
      run_cmd "STEP 2B - Create database with cmake build" \
      codeql database create "$DB" --language=cpp --source-root="$TARGET" \
      --command="bash -lc 'cmake -B build-codeql && cmake --build build-codeql'" --overwrite
  elif [ -f "$TARGET/Makefile" ]; then
    run_cmd "STEP 2B - Create database with make" \
      codeql database create "$DB" --language=cpp --source-root="$TARGET" \
      --command="make" --overwrite
  else
    log "ERROR STEP 2B no supported build file found"
    return 1
  fi
}

if [ -d "$DB" ] && find "$DB" -mindepth 1 -maxdepth 1 | read; then
  log "STEP 2 - Create database: existing database found; validating it"
  ensure_database_ready
else
  run_cmd "STEP 2A - Create database without build" \
    codeql database create "$DB" --language=cpp --source-root="$TARGET" --overwrite

  if [ ! -d "$DB" ] || ! find "$DB" -mindepth 1 -maxdepth 1 | read; then
    log "DB creation failed or produced empty database, trying with build command"
    if [ -f "$TARGET/CMakeLists.txt" ]; then
      run_cmd "STEP 2B - Create database with cmake build" \
        codeql database create "$DB" --language=cpp --source-root="$TARGET" \
        --command="bash -lc 'cmake -B build-codeql && cmake --build build-codeql'" --overwrite
    elif [ -f "$TARGET/Makefile" ]; then
      run_cmd "STEP 2B - Create database with make" \
        codeql database create "$DB" --language=cpp --source-root="$TARGET" \
        --command="make" --overwrite
    else
      log "ERROR STEP 2B no supported build file found"
    fi
  else
    ensure_database_ready
  fi
fi

mkdir -p "$RESULTS"
run_cmd "STEP 3 - Run security queries" \
  codeql database analyze "$DB" codeql/cpp-queries:codeql-suites/cpp-security-extended.qls \
  --format=sarif-latest --output="$RESULTS/security.sarif"

shopt -s nullglob
learned_queries=("$ROOT"/learned/queries/active/*.ql)
if [ "${#learned_queries[@]}" -gt 0 ]; then
  for q in "${learned_queries[@]}"; do
    base=$(basename "$q" .ql)
    run_cmd "STEP 4 - Run learned query $base" \
      codeql database analyze "$DB" "$q" --format=sarif-latest \
      --output="$RESULTS/${base}.sarif"
  done
else
  log "STEP 4 - Run learned queries: none found"
fi

log "STEP 5 - Parse SARIF results into findings JSON"
python3 - "$RESULTS" "$CURRENT" <<'PY'
import json
import os
import sys

results_dir, current_dir = sys.argv[1], sys.argv[2]
findings = []
idx = 1

for name in sorted(os.listdir(results_dir)):
    if not name.endswith(".sarif"):
        continue
    path = os.path.join(results_dir, name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        continue

    for run in data.get("runs", []):
        for result in run.get("results", []) or []:
            message = (
                (result.get("message") or {}).get("text")
                or (result.get("message") or {}).get("markdown")
                or ""
            )
            locations = result.get("locations") or []
            if locations:
                loc = locations[0].get("physicalLocation") or {}
                artifact = loc.get("artifactLocation") or {}
                region = loc.get("region") or {}
                file_path = artifact.get("uri", "")
                line = int(region.get("startLine") or 0)
            else:
                file_path = ""
                line = 0

            findings.append(
                {
                    "id": f"cql-{idx:03d}",
                    "rule": result.get("ruleId", ""),
                    "file": file_path,
                    "line": line,
                    "message": message,
                }
            )
            idx += 1

payload = {"findings": findings}
out_path = os.path.join(results_dir, "codeql_findings.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

copy_path = os.path.join(current_dir, "codeql_findings.json")
with open(copy_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

print(json.dumps({"parsed_files": len([n for n in os.listdir(results_dir) if n.endswith('.sarif')]), "findings": len(findings)}))
PY
parse_status=$?
if [ "$parse_status" -ne 0 ]; then
  log "ERROR STEP 5 parse exit=$parse_status"
else
  log "OK STEP 5"
fi

log "Workflow complete"
