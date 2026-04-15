# VALIDATION_STATUS

## Finding: protobuf-input-003

Status: CONFIRMED_MEMORY

Validated Against:
- Library: `builds/protobuf-asan-arm64/lib/libprotobuf.a`
- Build: `builds/protobuf-asan-arm64`
- Commit: `514aceb97`
- Date: `2026-04-15`

Compilation:
```bash
bash bugs/protobuf/protobuf-input-003/poc/build_real.sh
```

Execution:
```bash
cd bugs/protobuf/protobuf-input-003/poc
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real 2>&1 | tee ../validation/asan_output.txt
```

Evidence:
- Public API path: `google::protobuf::MessageLite::MergeFromString`
- Trigger state: destination repeated packed `fixed32` field forced to `INT_MAX` entries, then merged with one packed element
- ASan report: `bad parameters to __sanitizer_annotate_contiguous_container`
- Library stack frames:
  - `google::protobuf::internal::EpsCopyInputStream::ReadPackedFixed<unsigned int>()`
  - `bool google::protobuf::internal::MergeFromImpl<false>(...)`

Conclusion:
The bug is reproducible against the real compiled library through a public merge API. The observed outcome is a sanitizer-detected container annotation failure in protobuf library code after the packed fixed-field growth path overflows its size accounting.
