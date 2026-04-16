# VALIDATION_STATUS.md

## Finding: cord_input_negative_read

**Status:** FALSE_POSITIVE

**Validated Against:**
- Library: libprotobuf.a (ASan build)
- Build: builds/protobuf-asan-arm64/
- Date: 2026-04-15

**Source Analysis Notes:**
- `google::protobuf::internal::WireFormatLite::ReadBytes(io::CodedInputStream*, absl::Cord*)` reads a varint length into `int length` and then calls `input->ReadCord(value, length)`.
- `google::protobuf::io::CodedInputStream::ReadCord(absl::Cord*, int)` explicitly rejects `size < 0`, clears the output cord, and returns `false`.
- `google::protobuf::io::CodedInputStream::ReadVarintSizeAsInt(int*)` returns `false` when the decoded varint does not fit into a non-negative `int`.

**Compilation:**
```bash
./build_real.sh
```

**Evidence:**
- Runtime output: `validation/asan_output.txt`
- Machine-readable result: `validation/asan_result.json`
- Build log: `poc/build_real.log`

**Runtime Evidence:**
```text
direct_negative_read.ok=0
direct_negative_read.output_size=0
direct_negative_read.output_hex=
direct_negative_read.bytes_until_limit=-1
wireformat_readbytes.ok=0
wireformat_readbytes.output_size=9
wireformat_readbytes.output_hex=70726566696c6c6564
wireformat_readbytes.current_position=0
```

**Why Not Vulnerable:**
- `google::protobuf::io::CodedInputStream::ReadCord(absl::Cord*, int)` checks `size < 0`, clears the output cord, and returns `false`.
- `google::protobuf::io::CodedInputStream::ReadVarintSizeAsInt(int*)` returns `false` when the decoded length would become negative or overflow `int`.
- The malformed length-prefixed Cord path leaves the destination unchanged (`"prefilled"`) and does not advance the stream, so the operation aborts before any read into library-managed memory.

**Conclusion:** Revalidation against the real prebuilt ASan library did not reproduce any memory corruption or exploitable negative-length Cord read. The current source and runtime behavior indicate defensive handling, so this finding is a false positive.
