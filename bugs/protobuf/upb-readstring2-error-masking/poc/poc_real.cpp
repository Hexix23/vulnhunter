#include <cstdio>
#include <cstdlib>

#include "upb/mem/arena.h"
#include "upb/message/message.h"
#include "upb/wire/decode.h"
#include "upb/reflection/cmake/google/protobuf/descriptor.upb_minitable.h"

namespace {

int DecodeAndReport(const char* label, const char* data, size_t size) {
  upb_Arena* arena = upb_Arena_New();
  if (!arena) {
    std::fprintf(stderr, "arena allocation failed\n");
    return 100;
  }

  upb_Message* msg =
      upb_Message_New(&google__protobuf__FileDescriptorProto_msg_init, arena);
  if (!msg) {
    std::fprintf(stderr, "message allocation failed\n");
    upb_Arena_Free(arena);
    return 101;
  }

  const upb_DecodeStatus status =
      upb_Decode(data, size, msg, &google__protobuf__FileDescriptorProto_msg_init,
                 nullptr, 0, arena);

  std::printf("%s: status=%d (%s)\n", label, static_cast<int>(status),
              upb_DecodeStatus_String(status));

  upb_Arena_Free(arena);
  return static_cast<int>(status);
}

}  // namespace

int main() {
  // FileDescriptorProto.name = "A"
  const char valid[] = {static_cast<char>(0x0a), static_cast<char>(0x01), 'A'};

  // Same field, but the length says 5 bytes and only 1 payload byte follows.
  // Source analysis shows _upb_Decoder_ReadString2() maps this malformed read
  // failure to kUpb_DecodeStatus_OutOfMemory.
  const char truncated[] = {static_cast<char>(0x0a), static_cast<char>(0x05),
                            'A'};

  const int valid_status = DecodeAndReport("valid", valid, sizeof(valid));
  const int truncated_status =
      DecodeAndReport("truncated", truncated, sizeof(truncated));

  if (valid_status != static_cast<int>(kUpb_DecodeStatus_Ok)) {
    std::fprintf(stderr, "control decode failed unexpectedly\n");
    return 2;
  }

  if (truncated_status == static_cast<int>(kUpb_DecodeStatus_OutOfMemory)) {
    std::puts("finding confirmed: malformed input is reported as OutOfMemory");
    return 0;
  }

  if (truncated_status == static_cast<int>(kUpb_DecodeStatus_Malformed)) {
    std::puts("no reproduction: library reports Malformed");
    return 3;
  }

  std::fprintf(stderr, "unexpected status for truncated input: %d\n",
               truncated_status);
  return 4;
}
