#include <csetjmp>
#include <cstdio>
#include <cstring>

#include "upb/base/string_view.h"
#include "upb/mem/arena.h"
#include "upb/message/message.h"
#include "upb/reflection/cmake/google/protobuf/descriptor.upb_minitable.h"
#include "upb/wire/decode.h"
#include "upb/wire/eps_copy_input_stream.h"
#include "upb/wire/internal/decoder.h"
#include "upb/wire/reader.h"

namespace {

const char* LogicalPtr(const upb_EpsCopyInputStream& stream, const char* ptr) {
  const size_t position = reinterpret_cast<uintptr_t>(ptr) + stream.input_delta -
                          reinterpret_cast<uintptr_t>(stream.buffer_start);
  return stream.buffer_start + position;
}

void DumpBytes(const char* label, const char* data, size_t size) {
  std::printf("%s", label);
  for (size_t i = 0; i < size; ++i) {
    std::printf(" %02x", static_cast<unsigned char>(data[i]));
  }
  std::printf("\n");
}

void CaptureLowLevelStringRead() {
  const char truncated[] = {static_cast<char>(0x0a), static_cast<char>(0x05),
                            'A'};
  const char* ptr = truncated;
  upb_EpsCopyInputStream stream;
  upb_EpsCopyInputStream_Init(&stream, &ptr, sizeof(truncated));
  const char* logical_ptr = LogicalPtr(stream, ptr);

  std::printf("[low-level] initial ptr_offset=%td limit=%td error=%d\n",
              logical_ptr - truncated, stream.limit, stream.error);
  DumpBytes("[low-level] input bytes:", truncated, sizeof(truncated));

  uint32_t tag = 0;
  ptr = upb_WireReader_ReadTag(ptr, &tag, &stream);
  int size = -1;
  ptr = upb_WireReader_ReadSize(ptr, &size, &stream);
  logical_ptr = LogicalPtr(stream, ptr);
  std::printf("[low-level] tag=0x%x field=%u wire_type=%u declared_size=%d "
              "payload_offset=%td\n",
              tag, upb_WireReader_GetFieldNumber(tag),
              upb_WireReader_GetWireType(tag), size, logical_ptr - truncated);

  upb_StringView view = {"", 0};
  const char* ret =
      upb_EpsCopyInputStream_ReadStringAlwaysAlias(&stream, ptr, size, &view);

  const ptrdiff_t available_payload =
      sizeof(truncated) - (logical_ptr - truncated);
  std::printf("[low-level] read_ret=%p required_end_offset=%td "
              "available_payload=%zu\n",
              static_cast<const void*>(ret), (logical_ptr - truncated) + size,
              static_cast<size_t>(available_payload));
  std::printf("[low-level] stream.error=%d view.size=%zu\n", stream.error,
              view.size);
}

void CaptureDecoderReadString() {
  const char truncated[] = {static_cast<char>(0x0a), static_cast<char>(0x05),
                            'A'};
  const char* buf = truncated;
  upb_Arena* arena = upb_Arena_New();
  upb_Decoder decoder;
  const char* ptr = upb_Decoder_Init(&decoder, buf, sizeof(truncated), nullptr,
                                     0, arena, nullptr, 0);
  const char* logical_ptr = LogicalPtr(decoder.input, ptr);

  uint32_t tag = 0;
  ptr = upb_WireReader_ReadTag(ptr, &tag, &decoder.input);
  int size = -1;
  ptr = upb_WireReader_ReadSize(ptr, &size, &decoder.input);
  logical_ptr = LogicalPtr(decoder.input, ptr);
  std::printf("[decoder] before _upb_Decoder_ReadString: err.code=%d "
              "size=%d ptr_offset=%td limit=%td\n",
              decoder.err.code, size, logical_ptr - buf, decoder.input.limit);

  if (setjmp(decoder.err.buf) == 0) {
    upb_StringView view = {"", 0};
    const bool ok = _upb_Decoder_ReadString(&decoder, &ptr, size, &view, true);
    logical_ptr = LogicalPtr(decoder.input, ptr);
    std::printf("[decoder] returned ok=%d err.code=%d ptr_offset=%td "
                "view.size=%zu\n",
                ok, decoder.err.code, logical_ptr - buf, view.size);
  } else {
    std::printf("[decoder] longjmp err.code=%d (%s)\n", decoder.err.code,
                upb_DecodeStatus_String(
                    static_cast<upb_DecodeStatus>(decoder.err.code)));
  }

  upb_Arena_Free(arena);
}

void CapturePublicDecode() {
  const char truncated[] = {static_cast<char>(0x0a), static_cast<char>(0x05),
                            'A'};
  upb_Arena* arena = upb_Arena_New();
  upb_Message* msg =
      upb_Message_New(&google__protobuf__FileDescriptorProto_msg_init, arena);
  const upb_DecodeStatus status =
      upb_Decode(truncated, sizeof(truncated), msg,
                 &google__protobuf__FileDescriptorProto_msg_init, nullptr, 0,
                 arena);
  std::printf("[public] upb_Decode status=%d (%s)\n", static_cast<int>(status),
              upb_DecodeStatus_String(status));
  upb_Arena_Free(arena);
}

}  // namespace

int main() {
  CaptureLowLevelStringRead();
  CaptureDecoderReadString();
  CapturePublicDecode();
  return 0;
}
