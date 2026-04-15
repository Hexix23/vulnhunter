# F-005: ParseAny no size check before reparse

## Root cause analysis

`ParseAny()` in `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/json/internal/parser.cc:1039` calls `lex.BeginMark()`, scans the whole object for `@type`, then reparses `mark.value.UpToUnread()` through a fresh `JsonLexer` built over the fully buffered bytes. There is no object-size guard before the reparse path.

That means a large `google.protobuf.Any` JSON object is retained in memory in full while the first pass searches for `@type`, and then the same bytes are reparsed as the concrete embedded type. The PoC uses a `google.protobuf.FileDescriptorSet` payload with a repeated `file` field to force a large regular-message parse path inside `Any`.

## Requested ASan build path

I created the requested PoC source and Makefile equivalents in a writable absolute path under the repository because the sandbox would not permit writes to `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/parseany-no-size-check/` even though the directory exists.

ASan-targeted build command output:

```text
rm -f /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/.codex-tmp/parseany-no-size-check/poc/poc
/usr/bin/clang++ -arch arm64 -fsanitize=address -std=c++17 -O1 -g -I/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src -I/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/third_party/utf8_range -I/opt/homebrew/opt/abseil/include -I/opt/homebrew/include -arch arm64 -fsanitize=address -o /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/.codex-tmp/parseany-no-size-check/poc/poc /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/.codex-tmp/parseany-no-size-check/poc/poc.cc /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/build-audit-arm64/libprotobuf.a /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/build-audit-arm64/third_party/utf8_range/libutf8_range.a /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/build-audit-arm64/third_party/utf8_range/libutf8_validity.a /opt/homebrew/opt/abseil/lib/libabsl_base.dylib ... -lz -framework CoreFoundation
```

ASan run output:

```text
AddressSanitizer:DEADLYSIGNAL
==62697==ERROR: AddressSanitizer: SEGV on unknown address 0xffffd84fd7d9d8d9
...
#0 ... absl::lts_20260107::container_internal::raw_hash_set<...>::find_or_prepare_insert_large<...>
#1 ... google::protobuf::DescriptorPool::Tables::Tables()
#2 ... google::protobuf::DescriptorPool::DescriptorPool(...)
#3 ... google::protobuf::(anonymous namespace)::NewGeneratedPool()
#4 ... google::protobuf::DescriptorPool::InternalAddGeneratedFile(void const*, int)
#5 ... google::protobuf::internal::AddDescriptors(...)
...
SUMMARY: AddressSanitizer: SEGV ... in absl::...::find_or_prepare_insert_large(...)
==62697==ABORTING
```

The crash occurs before `main()`, during protobuf descriptor initialization. The local `build-audit-arm64/libprotobuf.a` was built with Apple Clang 21 ASan, but the host only exposes non-ASan Abseil dylibs under `/opt/homebrew/opt/abseil/lib/`, so the requested linkage is not a clean like-for-like ASan runtime environment.

## Observed parser behavior on matching non-ASan protobuf build

To isolate parser behavior from the ASan runtime mismatch, I rebuilt the same PoC source against `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/build-audit-plain-arm64/libprotobuf.a` and the matching `utf8_range` archives from that tree, while keeping the same source and payload structure.

Successful run output:

```text
Generated Any JSON payload bytes: 53043274 (50.59 MiB)
Expected ParseAny marked-buffer bytes: 53043274 (50.59 MiB)
Parse status: OK
Resident memory before parse: 63832064 (60.88 MiB)
Resident memory after parse: 201916416 (192.56 MiB)
Resident memory delta: 138084352 (131.69 MiB)
Parsed type_url bytes: 53
Parsed embedded value bytes: 52736000 (50.29 MiB)
```

This shows that:

1. A single `Any` JSON object larger than 50 MiB is accepted.
2. The concrete embedded payload is reparsed and serialized into `Any.value` with no size guard.
3. Resident memory grew by about 131.69 MiB while parsing a 50.59 MiB payload, which is consistent with the object being fully buffered and then materialized again during parse.

## Verdict

`confirmed`

The code path is vulnerable as described: `ParseAny()` buffers the full JSON object and reparses it without enforcing a size limit first. The exact requested ASan reproduction was blocked by a local toolchain/runtime mismatch between the ASan protobuf archive and the available Abseil libraries, but the same source tree's plain arm64 build demonstrates the unbounded buffering and successful oversized parse behavior directly.
