# LLDB Debug Report: `textformat-stackoverflow`

## Outcome

Status: `NOT_REPRODUCIBLE`

This workspace did not reach the claimed parser stack-overflow path. The exact runtime behavior on this host was:

1. The task's Rosetta probe returned no value, so native execution was attempted.
2. The exact compile command from the task failed because `../../../builds/protobuf-asan-arm64` is the wrong relative path from `bugs/protobuf/textformat-stackoverflow/debugging/`; the working build path in this repo is `../../../../builds/protobuf-asan-arm64`.
3. A fresh symbolized `poc_debug` was built successfully with `xcrun clang++ -arch arm64`, the corrected build path, and explicit Abseil dylibs.
4. LLDB loaded the binary and command file, but `run` failed immediately with `error: could not find 'debugserver'`.
5. GDB did not provide usable debugger output for this Mach-O binary. Its batch run failed with `Don't know how to run.  Try "help target".`
6. Running `./poc_debug` directly did not enter `TextFormat::Parser::ParseFromString`. It aborted first in `google::protobuf::DescriptorPool::Tables::Tables()` / `DescriptorPool::DescriptorPool()` while constructing the dynamic descriptor pool in `main`.
7. Additional parser-only fallback probes built under `debugging/` also aborted before `main()` during protobuf descriptor registration (`struct.pb.cc` / generated descriptor initialization), so no parser checkpoints executed.

## Source Evidence

The source in this checkout shows:

- `TextFormat::Parser::Parser()` initializes `recursion_limit_` to `std::numeric_limits<int>::max()` at [`text_format.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/text_format.cc:1940).
- The recursive parser path `ConsumeFieldMessage()` decrements and checks the limit before descending at [`text_format.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/text_format.cc:888).
- The same pre-recursion check also exists in `SkipFieldMessage()` and `SkipFieldValue()` at [`text_format.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/text_format.cc:924) and [`text_format.cc`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/text_format.cc:1094).

That means the requested root-cause statement, "no check before recursive call", does not match the parser source present in this repository snapshot.

## LLDB

Saved transcript: [`lldb_output.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/lldb_output.txt)

Relevant lines:

```text
(lldb) breakpoint set --name PrintUnknownFields
Breakpoint 1: 3 locations.
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

LLDB never launched the inferior, so no stack frames, no `bt`, and no `print recursion_limit_` output were produced.

## GDB

Saved transcript: [`gdb_output.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/gdb_output.txt)

Relevant lines:

```text
gdb_commands.txt:1: Error in sourced command file:
Don't know how to run.  Try "help target".
```

## Runtime Behavior

Saved transcript: [`state_output.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/state_output.txt)

Observed `poc_debug` failure:

```text
==ERROR: AddressSanitizer: SEGV on unknown address ...
    #0 ... raw_hash_set ... find_or_prepare_insert_large ...
    #1 google::protobuf::DescriptorPool::Tables::Tables()
    #2 google::protobuf::DescriptorPool::DescriptorPool()
    #3 main
```

Observed fallback probe failure:

```text
==ERROR: AddressSanitizer: SEGV on unknown address ...
    #19 google::protobuf::internal::AddDescriptors(...)
    #21 __cxx_global_var_init ... struct.pb.cc
```

Both crashes happen before parser recursion begins, so this run did not produce evidence of repeated `text_format.cc` parser frames or a stack-overflow at depth ~10,000.

## Artifacts

- [`poc_debug`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/poc_debug)
- [`lldb_commands.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/lldb_commands.txt)
- [`gdb_commands.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/gdb_commands.txt)
- [`lldb_output.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/lldb_output.txt)
- [`gdb_output.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/gdb_output.txt)
- [`state_output.txt`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/state_output.txt)
- [`poc_instrumented.cpp`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/poc_instrumented.cpp)
- [`poc_struct_instrumented.cpp`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/poc_struct_instrumented.cpp)
