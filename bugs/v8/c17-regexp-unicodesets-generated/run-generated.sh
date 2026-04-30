#!/usr/bin/env bash
set -u

V8_ROOT=${V8_ROOT:-/Users/carlosgomez/v8-engagement/v8/v8}
D8=${D8:-/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8}
OUT=${OUT:-/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/v8/c17-regexp-unicodesets-generated/evidence/generated-summary.txt}

HARNESS=(
  "$V8_ROOT/test/test262/data/harness/sta.js"
  "$V8_ROOT/test/test262/data/harness/assert.js"
  "$V8_ROOT/test/test262/data/harness/regExpUtils.js"
)

TEST_DIR="$V8_ROOT/test/test262/data/test/built-ins/RegExp/unicodeSets/generated"

: > "$OUT"
printf "d8=%s\n" "$D8" >> "$OUT"
printf "test_dir=%s\n\n" "$TEST_DIR" >> "$OUT"

pass=0
fail=0

for test in "$TEST_DIR"/*.js; do
  name=${test##*/}
  tmp=$(mktemp /tmp/c17-regexp-test.XXXXXX)
  "$D8" "${HARNESS[@]}" "$test" > "$tmp" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    pass=$((pass + 1))
    printf "PASS %s\n" "$name" >> "$OUT"
  else
    fail=$((fail + 1))
    printf "FAIL %s rc=%s\n" "$name" "$rc" >> "$OUT"
    sed -n '1,8p' "$tmp" >> "$OUT"
    printf "\n" >> "$OUT"
  fi
  rm -f "$tmp"
done

printf "\nsummary pass=%s fail=%s\n" "$pass" "$fail" >> "$OUT"
printf "%s\n" "$OUT"
