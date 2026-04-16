# OpenThread Virtual-Time Event Overflow

Validated on 2026-04-13 against the ASan build at `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread/build_posix_vt_asan`.

- Source: `src/posix/platform/virtual_time.cpp:211-221`
- Trigger: call `virtualTimeSendRadioSpinelWriteEvent()` with `aLength > OT_EVENT_DATA_MAX_SIZE`
- Result: stack-buffer-overflow in the real compiled library

Reproduction:

```bash
bash /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/openthread-vt-event-overflow/poc/build_real.sh
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/openthread-vt-event-overflow/poc/poc_real
```

Evidence:

- PoC: `bugs/openthread-vt-event-overflow/poc/poc_real.cpp`
- Build script: `bugs/openthread-vt-event-overflow/poc/build_real.sh`
- ASan output: `bugs/openthread-vt-event-overflow/poc/asan_real_library.txt`

Recommended fix:

Reject oversized payloads before the `memcpy()` and fail closed when `aLength > OT_EVENT_DATA_MAX_SIZE`.
