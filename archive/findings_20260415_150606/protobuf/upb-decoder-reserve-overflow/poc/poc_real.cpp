#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "upb/base/status.h"
#include "upb/mem/arena.h"
#include "upb/message/accessors.h"
#include "upb/message/internal/array.h"
#include "upb/message/message.h"
#include "upb/mini_descriptor/decode.h"
#include "upb/mini_descriptor/internal/encode.h"
#include "upb/mini_descriptor/internal/modifiers.h"
#include "upb/mini_table/field.h"
#include "upb/mini_table/message.h"
#include "upb/wire/decode.h"

namespace {

std::string BuildMiniDescriptor() {
  upb_MtDataEncoder enc = {};
  char buf[kUpb_MtDataEncoder_MinSize];
  enc.end = buf + sizeof(buf);

  std::string out;
  auto append = [&](char* end) {
    if (!end) {
      std::fprintf(stderr, "mini descriptor encoding failed\n");
      std::exit(2);
    }
    out.append(buf, end - buf);
  };

  append(upb_MtDataEncoder_StartMessage(&enc, buf, 0));
  append(upb_MtDataEncoder_PutField(&enc, buf, kUpb_FieldType_Fixed32, 1,
                                    kUpb_FieldModifier_IsRepeated |
                                        kUpb_FieldModifier_IsPacked));
  return out;
}

std::string EncodeVarint(uint64_t value) {
  std::string out;
  do {
    uint8_t byte = value & 0x7fU;
    value >>= 7;
    if (value) byte |= 0x80U;
    out.push_back(static_cast<char>(byte));
  } while (value);
  return out;
}

std::string BuildPackedFixed32Payload(size_t elem_count) {
  const size_t packed_bytes = elem_count * sizeof(uint32_t);
  std::string out;
  out.reserve(1 + 10 + packed_bytes);
  out.push_back(static_cast<char>((1u << 3) | 2u));
  out += EncodeVarint(packed_bytes);
  for (size_t i = 0; i < elem_count; ++i) {
    uint32_t v = static_cast<uint32_t>(i);
    out.append(reinterpret_cast<const char*>(&v), sizeof(v));
  }
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  const size_t elem_count =
      argc > 1 ? static_cast<size_t>(std::strtoull(argv[1], nullptr, 10))
               : 2 * 1024 * 1024;

  upb_Arena* mt_arena = upb_Arena_New();
  upb_Arena* msg_arena = upb_Arena_New();
  if (!mt_arena || !msg_arena) {
    std::fprintf(stderr, "arena allocation failed\n");
    return 2;
  }

  std::string mini_descriptor = BuildMiniDescriptor();
  upb_Status status;
  upb_Status_Clear(&status);
  upb_MiniTable* mt = upb_MiniTable_Build(mini_descriptor.data(),
                                          mini_descriptor.size(), mt_arena,
                                          &status);
  if (!mt) {
    std::fprintf(stderr, "upb_MiniTable_Build failed: %s\n",
                 upb_Status_ErrorMessage(&status));
    return 2;
  }

  const upb_MiniTableField* field = upb_MiniTable_GetFieldByIndex(mt, 0);
  if (!field) {
    std::fprintf(stderr, "failed to obtain field metadata\n");
    return 2;
  }

  upb_Message* msg = upb_Message_New(mt, msg_arena);
  if (!msg) {
    std::fprintf(stderr, "upb_Message_New failed\n");
    return 2;
  }

  std::string payload = BuildPackedFixed32Payload(elem_count);
  std::fprintf(stderr, "payload_bytes=%zu elem_count=%zu\n", payload.size(),
               elem_count);

  upb_DecodeStatus decode_status =
      upb_Decode(payload.data(), payload.size(), msg, mt, nullptr, 0, msg_arena);
  std::fprintf(stderr, "decode_status=%d (%s)\n", static_cast<int>(decode_status),
               upb_DecodeStatus_String(decode_status));

  upb_Array* arr = upb_Message_GetMutableArray(msg, field);
  size_t parsed = arr ? upb_Array_Size(arr) : 0;
  size_t capacity = arr ? upb_Array_Capacity(arr) : 0;
  std::fprintf(stderr, "parsed_count=%zu capacity=%zu\n", parsed, capacity);

  upb_Arena_Free(mt_arena);
  upb_Arena_Free(msg_arena);

  if (decode_status != kUpb_DecodeStatus_Ok) return 1;
  if (parsed != elem_count) {
    std::fprintf(stderr, "count mismatch: expected=%zu actual=%zu\n", elem_count,
                 parsed);
    return 1;
  }
  return 0;
}
