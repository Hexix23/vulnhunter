# VALIDATION_STATUS

## Finding

`parseany-no-size-check`

## Status

`LOGIC_BUG`

## Validated Against

- ASan build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Plain compiled library: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/build-audit-plain-arm64/libprotobuf.a`
- Date: `2026-04-15`

## Fresh PoC

- Source: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/parseany-no-size-check/poc/poc_real.cpp`
- Build script: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/parseany-no-size-check/poc/build_real.sh`

## ASan Build Result

The binary linked against the provided ASan archive, but execution failed before `main()` during protobuf descriptor initialization.

Evidence from `asan_output.txt`:

```text
AddressSanitizer:DEADLYSIGNAL
ERROR: AddressSanitizer: SEGV on unknown address 0xffffd84fd7d9d8d9
#0 ... raw_hash_set<...>::find_or_prepare_insert_large
#1 google::protobuf::DescriptorPool::Tables::Tables()
#2 google::protobuf::DescriptorPool::DescriptorPool(...)
#3 google::protobuf::(anonymous namespace)::NewGeneratedPool()
#4 google::protobuf::DescriptorPool::InternalAddGeneratedFile(void const*, int)
#5 google::protobuf::internal::AddDescriptors(...)
```

This crash does not validate the `ParseAny()` finding because the process aborts during static initialization, before the PoC enters the JSON parsing path.

## Real Library Behavior

The same fresh PoC was then run against the existing plain compiled protobuf archive to verify the parser path on the real library:

```text
Generated Any JSON payload bytes: 50331694
Resident memory before parse: 61095936 (58.27 MiB)
Resident memory after parse: 207290368 (197.69 MiB)
Resident memory delta: 146194432 (139.42 MiB)
Parse status: OK
Parsed type_url bytes: 53
Parsed embedded value bytes: 45866198
```

This shows that a ~48 MiB `google.protobuf.Any` JSON object is accepted and reparsed without any size guard, with a resident-memory increase of ~139 MiB during parsing.

## Conclusion

The source finding is real as a `LOGIC_BUG`: `ParseAny()` buffers and reparses large `Any` objects without enforcing a size limit first. The provided ASan build is not usable for direct path validation on this host because it crashes during descriptor initialization before the PoC reaches `JsonStringToMessage()`.
