# Related Issues Analysis: protobuf-input-002

## Similar Patterns Found

### Confirmed same bug family: response length narrowed to 32 bits before writing full body

| File | Line | Function | Pattern | Status |
|------|------|----------|---------|--------|
| `targets/protobuf/upb/conformance/conformance_upb.c` | 288-290 | `DoTestIo` | `(uint32_t)output_size` header, `output_size` body | CONFIRMED finding |
| `targets/protobuf/conformance/conformance_cpp.cc` | 248-253 | `Harness::ServeConformanceRequest` | `static_cast<uint32_t>(serialized_output.size())`, full body write | CONFIRMED similar |
| `targets/protobuf/conformance/conformance_objc.m` | 190-192 | `DoTestIo` | `(uint32_t)data.length`, full body write | CONFIRMED similar |
| `targets/protobuf/conformance/conformance_rust.rs` | 47-51 | `write_response_to_stdout` | `bytes.len() as u32`, full body write | CONFIRMED similar |
| `targets/protobuf/conformance/ConformanceJava.java` | 389-392 | `doTestIo` | `serializedOutput.length` written as 32-bit LE int, then full array write | CONFIRMED similar |
| `targets/protobuf/conformance/ConformanceJavaLite.java` | 343-346 | `doTestIo` | `serializedOutput.length` written as 32-bit LE int, then full array write | CONFIRMED similar |

These are not exact duplicates at the syntax level, but they implement the same protocol mistake: a 32-bit frame header emitted independently of a potentially larger serialized response buffer, with no explicit upper-bound check before the write.

### Potentially similar, language-runtime dependent

| File | Line | Function | Pattern | Status |
|------|------|----------|---------|--------|
| `targets/protobuf/conformance/conformance_python.py` | 135-137 | `do_test_io` | `struct.pack(\"<I\", len(serialized_response))` then full body write | NEEDS runtime check |
| `targets/protobuf/conformance/ruby/conformance_ruby.rb` | 112-114 | `do_test_io` | `pack('V')` on `serialized_response.length` then full body write | NEEDS runtime check |
| `targets/protobuf/conformance/conformance_php.php` | 173-175 | `doTestIo` | `pack('V', strlen(...))` then full body write | NEEDS runtime check |

These should be reviewed separately because the language runtime may throw, clamp, or wrap when asked to pack values above `UINT32_MAX`. The code still lacks an explicit logical guard, so the safety property depends on runtime behavior rather than a local invariant.

### Related request-side narrowing patterns

| File | Line | Function | Pattern | Status |
|------|------|----------|---------|--------|
| `targets/protobuf/conformance/fork_pipe_runner.cc` | 76-80 | `ForkPipeRunner::RunTest` | `static_cast<uint32_t>(request.size())` before writing request body | Similar pattern, parent-controlled input |
| `targets/protobuf/conformance/conformance_test.cc` | 560-562 | `ConformanceTestSuite::RunTest` | `static_cast<uint32_t>(serialized_request.size())` for debug/isolated framing | Similar pattern, lower security significance |

These are structurally similar but lower priority because the suite itself generates the request bytes and already expects a 32-bit framed protocol. They still merit cleanup for correctness and symmetry.

## Why the parent amplifies the impact

`ForkPipeRunner::RunTest()` trusts the 4-byte reply length from the child and performs:

1. `len = internal::little_endian::ToHost(len);`
2. `response.resize(len);`
3. `CheckedRead(read_fd_, response.c_str(), len);`

That means any child implementation that truncates the header but writes the full body creates the same desynchronization and allocation hazard in the parent, regardless of language.

## Search / Retry Log

1. Attempt 1 searched only for the exact cast form around `output_size`; this found the upb sink but missed other implementations.
2. Attempt 2 broadened to framing helpers, `sizeof(uint32_t)`, `to_le_bytes()`, `pack('V')`, and `writeLittleEndianIntToStdout`; this found the C++, Objective-C, Rust, Java, Java Lite, Ruby, PHP, and Python implementations.
3. Attempt 3 compared response writers against request writers to separate true sibling bugs from lower-risk protocol boilerplate.

## Recommended Additional Review

1. Add an explicit invariant in every testee implementation: reject or fail closed if serialized response size exceeds `UINT32_MAX`.
2. Add symmetry on the parent side: reject oversized requests before writing them to the child.
3. Centralize framing helpers instead of open-coding length-prefix I/O in each language implementation.
4. Add a regression test that forces the serializer helper to see a logical size above `UINT32_MAX` without needing an actual 4+ GiB allocation, if the language/runtime allows mocking or faking the reported length.
