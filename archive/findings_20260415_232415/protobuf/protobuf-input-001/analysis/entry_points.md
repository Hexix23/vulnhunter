# Entry Point Analysis: protobuf-input-001

## External Input Sources

| Source | Protocol | Authentication | Rate Limited |
|--------|----------|----------------|--------------|
| Conformance runner child pipe | 4-byte little-endian length + raw `ConformanceRequest` bytes over stdin/stdout | None in code | No |
| Manual/local invocation of `conformance_upb` | Same length-prefixed stdin framing | None | No |

## External Input Contract

The official conformance infrastructure defines a subprocess protocol where the parent sends:

1. A 4-byte request length.
2. Exactly that many request bytes.
3. The child replies with a 4-byte response length.
4. The child replies with that many response bytes.

That contract is documented in [`targets/protobuf/conformance/conformance_test_runner.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/conformance_test_runner.cc#L10) and implemented by [`targets/protobuf/conformance/fork_pipe_runner.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/fork_pipe_runner.cc#L69).

## Call Chains

### Chain 1: Standard conformance execution path

```text
RunConformanceTests()
  -> ConformanceTestSuite::RunTest()
     -> request.SerializeToString(&serialized_request)
     -> runner_->RunTest(test_name, serialized_request)
        -> ForkPipeRunner::RunTest()
           -> CheckedWrite(write_fd_, &len, sizeof(uint32_t))
           -> CheckedWrite(write_fd_, request.data(), request.size())
              -> child stdin
                 -> main()
                    -> DoTestIo(symtab)
                       -> CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))
                       -> upb_Arena_New()
                       -> upb_Arena_Malloc(c.arena, input_size)   [vulnerable]
                       -> CheckedRead(STDIN_FILENO, input, input_size)
                       -> conformance_ConformanceRequest_parse(input, input_size, c.arena)
```

Evidence:
- `RunConformanceTests()` is the public entry used by the conformance binary in [`targets/protobuf/conformance/conformance_test.h`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/conformance_test.h#L46).
- `ConformanceTestSuite::RunTest()` serializes the request and hands it to the runner in [`targets/protobuf/conformance/conformance_test.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/conformance_test.cc#L558) and [`targets/protobuf/conformance/conformance_test.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/conformance_test.cc#L602).
- `ForkPipeRunner::RunTest()` writes the frame length and body in [`targets/protobuf/conformance/fork_pipe_runner.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/fork_pipe_runner.cc#L76).
- `DoTestIo()` consumes that frame and allocates the full size before parsing in [`targets/protobuf/upb/conformance/conformance_upb.c`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/conformance/conformance_upb.c#L253).

### Chain 2: Direct stdin-driven invocation

```text
Local script / operator / custom harness
  -> exec ./conformance_upb
     -> main()
        -> while (1) DoTestIo(symtab)
           -> CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))
           -> upb_Arena_Malloc(c.arena, input_size)   [vulnerable]
```

This second path is realistic because the conformance tooling itself emits instructions for piping serialized requests directly into a testee during debug workflows in [`targets/protobuf/conformance/conformance_test.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/conformance/conformance_test.cc#L573).

## Reachability Assessment

- **Network reachable:** No direct network listener is present in `conformance_upb`.
- **Local/IPC reachable:** Yes. Any local process that can feed the child pipe or stdin can trigger the bug.
- **Authentication required:** No.
- **Requires valid protobuf payload:** No. The allocation happens before `conformance_ConformanceRequest_parse()`.
- **Input validation before allocation:** None.
- **Size limits before allocation:** None.
- **Rate limiting / throttling:** None in the testee.

## Trust Boundary Notes

The vulnerable size is not an internal protobuf field length. It is the outer framing length used by the conformance harness itself. That narrows the scope to harness/testee deployments, but it also means parser-level validation and protobuf wire limits do not mitigate the initial allocation request.
