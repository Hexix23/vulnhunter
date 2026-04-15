# Codex Validation Test: textformat-stackoverflow

**Date:** 2026-04-15
**Rosetta:** YES

## ASan Results
- Compiled: YES
- Executed: PARTIAL
- Detected issue: NO for the claimed stack-overflow path; YES for an unexpected early ASan crash in the preexisting binary
- Output:
  - `poc_real.cpp` was missing in `bugs/protobuf/textformat-stackoverflow/poc/`, so I recreated it as a minimal PoC that builds a deeply nested `google::protobuf::UnknownFieldSet` with `AddGroup()` and calls `google::protobuf::TextFormat::Printer::PrintUnknownFieldsToString()`.
  - Baseline compile with the provided command failed at link time with many missing Abseil symbols and an ASan runtime mismatch.
  - Working compile required the documented fallback style:
    - `xcrun clang++ -arch arm64`
    - `-I/opt/homebrew/include`
    - `-L/opt/homebrew/lib`
    - the broad `/opt/homebrew/opt/abseil/lib/libabsl*.dylib` set
    - `-lz -lc++ -lm`
  - The successful compile produced an arm64 Mach-O `poc_test`, but in this translated shell the artifact was not stable for direct execution. `./poc_test` first failed with `No such file or directory`, then explicit `/usr/bin/arch -arm64 ./poc_test` failed with `arch: ./poc_test isn't executable`.
  - The preexisting `bugs/protobuf/textformat-stackoverflow/poc/poc_real` binary does execute, but ASan reports an early `SEGV` before the intended recursion path:
    - crash in `absl::...raw_hash_set::find_or_prepare_insert_large`
    - called from `google::protobuf::DescriptorPool::Tables::Tables()`
    - then `google::protobuf::DescriptorPool::DescriptorPool()`
    - then `main`
  - That ASan output is not a stack-overflow trace through `google::protobuf::TextFormat::Printer::PrintUnknownFields`. Based on this run, I did not reproduce the claimed stack overflow.

## LLDB Results
- Available: YES
- Worked: NO
- Error:
  - `/opt/homebrew/opt/llvm/bin/lldb --version` worked and reported `lldb version 22.1.3`.
  - Required command:
    - `/opt/homebrew/opt/llvm/bin/lldb ./poc_real -o "breakpoint set -n main" -o "run" -o "bt" -o "quit"`
  - Result:
    - target creation worked
    - breakpoint on `main` was set
    - `run` failed with `error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH`
  - Fallback attempt with Xcode `lldb` also failed:
    - breakpoint resolved to `poc_real.cpp:17`
    - `run` failed with `error: the platform is not currently connected`
  - `xcrun --find debugserver` failed with:
    - `unable to find utility "debugserver", not a developer tool or in PATH`

## GDB Results
- Available: YES
- Worked: NO
- Error:
  - `/opt/homebrew/bin/gdb --version` worked and reported `GNU gdb (GDB) 17.1`
  - Required command:
    - `/opt/homebrew/bin/gdb -batch -ex "run" -ex "bt" ./poc_real`
  - Result:
    - GDB did not launch the inferior and returned `Don't know how to run.  Try "help target".`
    - backtrace was empty: `No stack.`
    - GDB also emitted many DWARF parsing errors against the `.dSYM`, for example:
      - `DW_FORM_GNU_str_index or DW_FORM_strx used without .debug_str section in CU at offset 0x0`

## Conclusion
I was able to recreate a fresh PoC source and compile it against the real protobuf ASan build, but only after switching to `xcrun clang++ -arch arm64` and adding broad fallback link dependencies for Abseil and standard libraries.

I was not able to validate the specific `textformat-stackoverflow` claim from this environment. The freshly compiled binary was not reliably runnable from the translated shell, and the preexisting runnable binary crashed much earlier during `DescriptorPool` initialization instead of showing recursive stack growth in `TextFormat::Printer::PrintUnknownFields`.

Debugger support is also effectively blocked here:
- Homebrew LLDB cannot run without `debugserver`
- Xcode LLDB reports platform connection failure
- GDB does not launch the target and also fails to consume the DWARF cleanly

Recommendation:
- rerun on a native arm64 shell, not under Rosetta
- ensure `debugserver` is installed and reachable for LLDB
- rebuild the PoC binary and verify it runs before attaching debuggers
- only call this finding confirmed if ASan or a debugger shows a crash/backtrace in the actual `TextFormat::Printer::PrintUnknownFields` recursion path
