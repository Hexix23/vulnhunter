# OpenThread Virtual-Time Missing `forkpty-arg`

Validated on 2026-04-13 against the ASan build at `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread/build_posix_vt_asan`.

- Source: `src/posix/platform/spinel_manager.cpp:185-191`
- Trigger: initialize the POSIX spinel manager in virtual-time mode with a `spinel+hdlc+forkpty://...` URL that omits every `forkpty-arg`
- Result: null-pointer dereference in `atoi(nodeId)` from the real compiled library

Reproduction:

```bash
bash /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/openthread-vt-nodeid-null/poc/build_real.sh
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/openthread-vt-nodeid-null/poc/poc_real
```

Evidence:

- PoC: `bugs/openthread-vt-nodeid-null/poc/poc_real.cpp`
- Build script: `bugs/openthread-vt-nodeid-null/poc/build_real.sh`
- ASan output: `bugs/openthread-vt-nodeid-null/poc/asan_real_library.txt`

Recommended fix:

Verify that at least one `forkpty-arg` was supplied and return `OT_EXIT_INVALID_ARGUMENTS` before calling `atoi()`.
