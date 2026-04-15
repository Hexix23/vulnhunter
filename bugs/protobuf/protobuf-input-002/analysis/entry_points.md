# Entry Point Analysis: protobuf-input-002

## External Input Sources

| Source | Protocol / Medium | Authentication | Notes |
|--------|-------------------|----------------|-------|
| In-memory text buffer | Caller-supplied `const void* data, size_t size` | Caller-defined | Directly exposed by `upb_Tokenizer_New()` in [`targets/protobuf/upb/io/tokenizer.h:87`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.h#L87) |
| Streaming text input | `upb_ZeroCopyInputStream` | Caller-defined | Additional chunks are consumed in `Refresh()` and appended to the current token |
| Escaped string literal text | Caller-supplied `const char* text` | Caller-defined | Directly exposed by `upb_Parse_String()` in [`targets/protobuf/upb/io/tokenizer.h:125`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.h#L125) |

## Call Chains

### Chain 1: Tokenizer over flat or streaming text

```text
External text input
  -> upb_Tokenizer_New(data, size, input, options, arena)
  -> upb_Tokenizer_Next()
  -> StartToken() / RecordTo()
  -> Refresh() or StopRecording()
  -> upb_String_Append()
  -> vulnerable arithmetic in upb_String_Append()
```

Evidence:
- Public constructor in [`targets/protobuf/upb/io/tokenizer.h:87`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.h#L87)
- Public iteration API in [`targets/protobuf/upb/io/tokenizer.h:95`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.h#L95)
- Token recording append in [`targets/protobuf/upb/io/tokenizer.c:206`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.c#L206) and [`targets/protobuf/upb/io/tokenizer.c:258`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.c#L258)
- Vulnerable helper in [`targets/protobuf/upb/io/string.h:85`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/string.h#L85)

### Chain 2: Escaped string parsing helper

```text
External string literal text
  -> upb_Parse_String(text, arena)
  -> AppendUTF8() / upb_String_PushBack()
  -> upb_String_Append()
  -> vulnerable arithmetic in upb_String_Append()
```

Evidence:
- Public parser API in [`targets/protobuf/upb/io/tokenizer.h:125`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.h#L125)
- Reserve before decode loop in [`targets/protobuf/upb/io/tokenizer.c:853`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.c#L853)
- UTF-8 append in [`targets/protobuf/upb/io/tokenizer.c:801`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/tokenizer.c#L801)
- Vulnerable helper in [`targets/protobuf/upb/io/string.h:87`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/string.h#L87)

## Reachability Assessment

- **Public API reachable:** Yes. The vulnerable helper is not static-only dead code; it is reached from exported tokenizer APIs declared in `upb/io/tokenizer.h`.
- **Attacker control:** High. Both `size` and byte contents originate from external text buffers or streaming chunks.
- **Precondition for trigger:** The internal `upb_String` must already hold a very large logical size near `SIZE_MAX`, so the bug is realistic only when a caller keeps appending attacker-controlled data into the same token/output string.
- **Network reachability:** Indirect. Any service that exposes textproto/token parsing through these APIs can be driven remotely, but there is no direct built-in network listener in `upb`.
- **File reachability:** Yes. A caller can feed file contents through the flat-buffer or `upb_ZeroCopyInputStream` tokenizer interface.
- **Snapshot-specific caveat:** Consensus already noted that the provided `libupb.a` artifact does not include tokenizer objects, so the confirmed bug is source-reachable and API-reachable, but not directly reproducible through the shipped archive in this repository snapshot.

## Entry Point Notes

- I first searched direct callers of `upb_String_Append()` and found only `upb/io/tokenizer.c` plus inline wrappers in `string.h`.
- I then searched for all uses of `upb_Tokenizer_*` and `upb_Parse_String()` under `targets/protobuf/upb/`. No additional `upb` wrapper API was found in this snapshot, so the exported tokenizer functions themselves are the practical public entry points.
- `upb_JsonDecode()` was reviewed separately and does not use `upb/io/string.h`, so it is not an entry path for this finding.
