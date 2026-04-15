Status: LOGIC_BUG

Evidence:
The ASan PoC completed without an ASan finding, crash, or large allocation. LLDB could not launch in this environment because `debugserver` was unavailable to the process, so runtime state was captured with a debug-instrumented fallback binary. Key evidence from `debugging/state_capture_output.txt`:

```text
case=wraps_negative_int
decoded_length_u32=2147483648
decoded_length_i32=-2147483648
read_string_ok=false
bytes_until_limit_after_readstring=1
current_position_after_readstring=6

case=all_bits_set
decoded_length_u32=4294967295
decoded_length_i32=-1
read_string_ok=false
bytes_until_limit_after_readstring=1
current_position_after_readstring=6
```

The original ASan output in `poc/asan_output.txt` remains:

```text
== INT_MAX ==
declared_length=2147483647
wire_size=7
tag=0xa
parse_ok=false
parsed_size=1
bytes_remaining=-1

== 2GB_exact ==
declared_length=2147483648
wire_size=7
tag=0xa
parse_ok=false
parsed_size=0
bytes_remaining=-1
```

Root cause:
`ReadBytesToString` at `src/google/protobuf/wire_format_lite.cc:545-548` does not perform its own size cap before forwarding the varint length to `CodedInputStream::ReadString`:

```c++
uint32_t length;
return input->ReadVarint32(&length) && input->ReadString(value, length);
```

However, the tested parser path is guarded downstream in `src/google/protobuf/io/coded_stream.cc:261-305`:
- `ReadString()` rejects negative sizes immediately (`if (size < 0) return false;`).
- It only resizes the string when `BufferSize() >= size`.
- Otherwise `ReadStringFallback()` appends available bytes and returns `false` on `Refresh()` when the declared bytes are not actually present.
- `ReadStringFallback()` only calls `reserve(size)` when stream limits indicate that many bytes are genuinely available.

So the missing local cap in `ReadBytesToString` did not translate into reproducible unbounded allocation or OOM on malformed truncated input, but it does produce incorrect signed state at the `ReadString(int)` boundary.

Reproduction command:

```bash
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/readbytestostring-no-size-cap/poc/build.sh && \
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/readbytestostring-no-size-cap/poc/run.sh
```

Notes:
- The requested build directory `targets/protobuf/build-review-asan-arm64` is ASan-instrumented but actually contains `x86_64` archives in this environment, while Homebrew `absl` is `arm64` only. The runnable PoC was therefore linked against the existing ASan `arm64` build at `targets/protobuf/build-audit-arm64`.
