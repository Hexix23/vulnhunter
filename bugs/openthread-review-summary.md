# OpenThread Review Summary

Review date: 2026-04-13

Repository under review:

- `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread`

## Validated Crash Findings

### 1. `RadioUrl::Init()` off-by-one leaves `mUrl` unterminated

- Severity: High
- Source: `src/posix/platform/radio_url.cpp:147-153`
- Impact: crafted 511-byte radio URLs trigger an out-of-bounds read and process abort during startup
- Evidence:
  - PoC: `bugs/openthread-radiourl-oob/poc/poc_real.cpp`
  - ASan: `bugs/openthread-radiourl-oob/poc/asan_real_library.txt`

### 2. Virtual-time spinel send path writes past `VirtualTimeEvent::mData`

- Severity: High
- Source: `src/posix/platform/virtual_time.cpp:211-221`
- Impact: oversized virtual-time frames cause stack memory corruption in the host process
- Evidence:
  - PoC: `bugs/openthread-vt-event-overflow/poc/poc_real.cpp`
  - ASan: `bugs/openthread-vt-event-overflow/poc/asan_real_library.txt`

### 3. Missing `forkpty-arg` crashes virtual-time startup

- Severity: Medium
- Source: `src/posix/platform/spinel_manager.cpp:185-191`
- Impact: invalid but plausible `forkpty://` URLs crash the process instead of returning a parse error
- Evidence:
  - PoC: `bugs/openthread-vt-nodeid-null/poc/poc_real.cpp`
  - ASan: `bugs/openthread-vt-nodeid-null/poc/asan_real_library.txt`

## Validated Logic Findings

### 4. URL numeric parsing accepts malformed values

- Severity: Medium
- Source: `src/lib/url/url.cpp:121-131`, `src/lib/url/url.cpp:163-173`
- Impact: malformed numeric parameters such as `09`, `12oops`, and empty strings are accepted and silently coerced
- Evidence:
  - PoC: `targets/openthread/bugs/review-url-numeric-parser/poc/poc_real.cpp`
  - Output: `targets/openthread/bugs/review-url-numeric-parser/poc/output.txt`

### 5. Spinel/NCP setters truncate oversized values with success status

- Severity: Medium
- Source: `src/ncp/ncp_base.cpp:1539-1547`, `src/ncp/ncp_base_mtd.cpp:688-696`, `src/ncp/ncp_base_mtd.cpp:1312-1320`, `src/ncp/ncp_base_mtd.cpp:1537-1545`
- Impact: oversized `SPINEL_PROP_PHY_CHAN`, dataset channel, and `SPINEL_PROP_NET_KEY_SWITCH_GUARDTIME` values wrap to smaller integers while returning success
- Evidence:
  - PoC: `targets/openthread/bugs/review-ncp-logic-bugs/poc/poc_real.cpp`
  - Output: `targets/openthread/bugs/review-ncp-logic-bugs/poc/output.txt`

## Recommended Fix Themes

- Replace lossy casts with explicit range checks and return `OT_ERROR_INVALID_ARGS` on overflow.
- For fixed-size stack buffers, validate lengths before copy and reject oversized frames.
- After bounded copies, always force a trailing `'\0'` before handing strings to parsers.
- Reject empty, partially parsed, or non-decimal numeric URL values by checking `endptr` and `errno`.
