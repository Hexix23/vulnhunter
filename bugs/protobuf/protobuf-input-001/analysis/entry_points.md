# Entry Point Analysis: protobuf-input-001

## External Input Sources

| Source | Protocol | Authentication | Rate Limited | Reaches Vulnerable Code |
|--------|----------|----------------|--------------|--------------------------|
| `conformance_test_runner` pipe | Local stdin/stdout pipe, 4-byte little-endian frame + payload | None in the protocol | No | Yes |
| Manual execution of `conformance_upb` | Local stdin/stdout pipe using the same framing protocol | None | No | Yes |
| Manual execution of `conformance_upb_dynamic_minitable` | Local stdin/stdout pipe using the same framing protocol | None | No | Yes |

## Exposure Summary

- The bug is in a `testonly = 1` executable, not in a shipped library API. See `cc_binary(name = "conformance_upb", testonly = 1, srcs = ["conformance_upb.c"])` in `targets/protobuf/upb/conformance/BUILD`.
- The binary is normally exercised by `conformance_test_runner`, which documents the pipe protocol as:
  1. tester sends 4-byte little-endian length `N`
  2. tester sends `N` bytes of serialized `ConformanceRequest`
  3. testee sends 4-byte little-endian length `M`
  4. testee sends `M` bytes of serialized `ConformanceResponse`
- Any caller that can write arbitrary bytes to the testee's stdin can supply the attacker-controlled `input_size` consumed by `DoTestIo()`.

## Call Chains

### Chain 1: Normal automated conformance run

```text
Bazel sh_test test_conformance_upb
  -> conformance_test_runner
    -> ForkPipeRunner::RunTest()
      -> child process stdin
        -> main() in conformance_upb.c
          -> while (1) { DoTestIo(symtab); }
            -> CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))
            -> input = upb_Arena_Malloc(c.arena, input_size)
            -> CheckedRead(STDIN_FILENO, input, input_size)   [vulnerable sink]
```

Evidence:

- `targets/protobuf/upb/conformance/BUILD:55` defines `conformance_upb`.
- `targets/protobuf/upb/conformance/BUILD:88` defines `test_conformance_upb`, which passes `//conformance:conformance_test_runner` and `:conformance_upb`.
- `targets/protobuf/conformance/fork_pipe_runner.cc:77-80` writes a 32-bit frame length plus request bytes to the child.
- `targets/protobuf/upb/conformance/conformance_upb.c:261-270` reads that length and allocates/reads the corresponding input buffer.

### Chain 2: Direct execution of the vulnerable binary

```text
Any local process / user
  -> exec ./conformance_upb
    -> stdin bytes under caller control
      -> main()
        -> DoTestIo(symtab)
          -> CheckedRead(..., &input_size, 4)
          -> upb_Arena_Malloc(c.arena, input_size)
          -> CheckedRead(..., input, input_size)             [vulnerable sink]
```

This does not require the official runner. The binary only expects framed stdin/stdout I/O, as described in `targets/protobuf/conformance/README.md`.

### Chain 3: Alternate executable built from the same source

```text
Any local process / user
  -> exec ./conformance_upb_dynamic_minitable
    -> main() from the same conformance_upb.c translation unit
      -> DoTestIo(symtab)
        -> same vulnerable allocation/read path
```

Evidence:

- `targets/protobuf/upb/conformance/BUILD:108-121` defines `conformance_upb_dynamic_minitable` with `srcs = ["conformance_upb.c"]`.
- The vulnerable function is therefore reachable in both test binaries.

## Internal Data Flow

```text
External framed stdin
  -> CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))
  -> attacker-controlled uint32_t input_size
  -> upb_Arena_New()
  -> upb_Arena_Malloc(c.arena, input_size)
  -> CheckedRead(STDIN_FILENO, input, input_size)
  -> conformance_ConformanceRequest_parse(input, input_size, c.arena)
  -> DoTest()
  -> conformance_ConformanceResponse_serialize(..., &output_size)
  -> uint32_t network_out = (uint32_t)output_size
  -> CheckedWrite(STDOUT_FILENO, &network_out, 4)
  -> CheckedWrite(STDOUT_FILENO, output, output_size)
```

## Reachability Assessment

- **Network reachable:** No direct network listener is present in this binary.
- **Local/IPC reachable:** Yes. The intended interface is a pipe-based IPC protocol over stdin/stdout.
- **Requires authentication:** No protocol-level authentication.
- **Input validation before sink:** None on `input_size` before allocation and second-stage read.
- **Preconditions:** Ability to run the test binary or act as its stdin peer.
- **Practical scope:** Primarily CI, local testing, fuzzing, or developer environments where the conformance executable is launched.
