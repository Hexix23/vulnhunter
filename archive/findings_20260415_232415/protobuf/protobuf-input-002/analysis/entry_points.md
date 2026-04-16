# Entry Point Analysis: protobuf-input-002

## External Input Sources

| Source | Protocol | Authentication | Rate Limited |
|--------|----------|----------------|--------------|
| Conformance test runner parent process | Local pipe over `stdin`/`stdout` | None in-process; trust boundary is the child testee | No |
| Isolated test execution | Serialized `ConformanceRequest` generated from suite test cases and piped into the child | None | No |
| Debug/standalone reproduction | Any process that can speak the 4-byte little-endian length + protobuf body protocol to the testee binary | None | No |

## Reachable Public Entry Points

### Chain 1: Standard conformance run

```text
main() in conformance_test_runner.cc
  -> ConformanceTestSuite::RunSuite()
  -> ConformanceTestSuite::RunTest()
  -> ForkPipeRunner::RunTest()
  -> child process execv("conformance_upb")
  -> main() in conformance_upb.c
  -> DoTestIo()
  -> conformance_ConformanceResponse_serialize()
  -> VULNERABLE SINK: uint32_t network_out = (uint32_t)output_size
```

Evidence:
- `conformance_test_runner.cc` instantiates `ForkPipeRunner` with the selected testee binary at lines 255-258.
- `ConformanceTestSuite::RunTest()` serializes a request and forwards it to `runner_->RunTest()` at lines 557-562 and 599-603.
- `ForkPipeRunner::RunTest()` writes the framed request to the child and then trusts the 4-byte response length when sizing the read buffer at lines 76-80 and 115-117.
- `conformance_upb.c` reads the request from `stdin`, serializes the response, truncates `output_size` to `uint32_t`, then writes `output_size` bytes anyway at lines 261-290.

### Chain 2: Dynamic minitable variant

```text
main() in conformance_test_runner.cc
  -> ForkPipeRunner(program="conformance_upb_dynamic_minitable")
  -> main() in conformance_upb.c with -DREBUILD_MINITABLES
  -> DoTestIo()
  -> same vulnerable framing logic
```

Evidence:
- `upb/conformance/BUILD` reuses the same `conformance_upb.c` source for `conformance_upb_dynamic_minitable`.
- The bug is source-level in `DoTestIo()`, so both binaries inherit it.

### Chain 3: Direct local invocation of the testee protocol

```text
Any local process
  -> write 4-byte little-endian request size to child stdin
  -> write serialized ConformanceRequest
  -> DoTestIo()
  -> truncated 4-byte response length + full response body on stdout
```

Rationale:
- `DoTestIo()` is the top-level I/O loop for the child process and accepts unauthenticated framed input from `stdin`.
- The framing format is documented in `conformance_test_runner.cc` and `fork_pipe_runner.cc` comments as a 4-byte little-endian length followed by the serialized protobuf body.

## Input-to-Sink Details

### External input that influences `output_size`

```text
4-byte request length on stdin
  -> CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))
  -> request bytes allocated and read
  -> conformance_ConformanceRequest_parse(input, input_size, ...)
  -> DoTest(&c)
  -> parse_input()/write_output()
  -> serialize_proto()/serialize_text()/serialize_json()
  -> conformance_ConformanceResponse_serialize(c.response, ..., &output_size)
  -> uint32_t network_out = (uint32_t)output_size
  -> CheckedWrite(..., &network_out, 4)
  -> CheckedWrite(..., output, output_size)
```

The attacker-controlled request does not set the length field directly, but it controls the response shape and encoding mode. A sufficiently amplification-heavy request can drive `output_size` past `UINT32_MAX`, at which point the sink emits an inconsistent frame header/body pair.

## Reachability Assessment

- Network reachable: No direct network listener in this binary.
- Inter-process reachable: Yes. The parent test harness communicates over inherited pipes.
- Requires authentication: No.
- Requires special deployment: Yes. This code is for the conformance harness rather than a production server path.
- Input validation before sink: None for oversized serialized responses. `DoTestIo()` never checks `output_size <= UINT32_MAX` before narrowing.
- Existing size limits: Request framing is limited to 32 bits on input, but response serialization uses `size_t` and is not bounded before the 32-bit cast.

## Search / Retry Notes

1. Attempt 1 searched direct references to `DoTestIo()` and framing helpers in `targets/protobuf`; this located the vulnerable sink and the parent harness.
2. Attempt 2 searched build files for the executable wiring; this found the dynamic minitable variant reusing the same source file.
3. Attempt 3 broadened to the conformance harness (`conformance_test_runner.cc`, `conformance_test.cc`, `fork_pipe_runner.cc`) to complete the public entry-point chain.
4. No additional public APIs reached this sink beyond the conformance child protocol.
