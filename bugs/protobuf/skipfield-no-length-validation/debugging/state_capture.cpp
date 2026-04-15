#include <cstdint>
#include <cstdio>
#include <string>

#define private public
#define protected public
#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"
#include "google/protobuf/wire_format_lite.h"
#undef protected
#undef private

namespace {

void AppendVarint(uint64_t value, std::string* out) {
  while (value >= 0x80) {
    out->push_back(static_cast<char>((value & 0x7f) | 0x80));
    value >>= 7;
  }
  out->push_back(static_cast<char>(value));
}

std::string MakeMalformedUnknownLengthDelimited() {
  std::string payload;
  constexpr uint32_t kFieldNumber = 123;
  constexpr uint32_t kWireTypeLengthDelimited = 2;
  AppendVarint((static_cast<uint64_t>(kFieldNumber) << 3) |
                   kWireTypeLengthDelimited,
               &payload);
  AppendVarint(0x7ffffff0u, &payload);
  payload.append("ABC", 3);
  return payload;
}

void DumpBytes(const std::string& payload) {
  std::fprintf(stderr, "payload_bytes:");
  for (unsigned char byte : payload) {
    std::fprintf(stderr, " %02x", byte);
  }
  std::fprintf(stderr, "\n");
}

void DumpState(const char* label,
               const google::protobuf::io::CodedInputStream& input) {
  std::fprintf(stderr, "[STATE] %s\n", label);
  std::fprintf(stderr, "  CurrentPosition()=%d\n", input.CurrentPosition());
  std::fprintf(stderr, "  BytesUntilLimit()=%d\n", input.BytesUntilLimit());
  std::fprintf(stderr, "  BufferSize()=%d\n", input.BufferSize());
  std::fprintf(stderr, "  current_limit_=%d\n", input.current_limit_);
  std::fprintf(stderr, "  buffer_size_after_limit_=%d\n",
               input.buffer_size_after_limit_);
  std::fprintf(stderr, "  total_bytes_limit_=%d\n", input.total_bytes_limit_);
  std::fprintf(stderr, "  total_bytes_read_=%d\n", input.total_bytes_read_);
  std::fprintf(stderr, "  buffer_ptr=%p\n", static_cast<const void*>(input.buffer_));
  std::fprintf(stderr, "  buffer_end=%p\n",
               static_cast<const void*>(input.buffer_end_));
  if (input.buffer_ != nullptr && input.buffer_end_ != nullptr &&
      input.buffer_ < input.buffer_end_) {
    const int remaining =
        static_cast<int>(input.buffer_end_ - input.buffer_) < 8
            ? static_cast<int>(input.buffer_end_ - input.buffer_)
            : 8;
    std::fprintf(stderr, "  next_bytes:");
    for (int i = 0; i < remaining; ++i) {
      std::fprintf(stderr, " %02x", input.buffer_[i]);
    }
    std::fprintf(stderr, "\n");
  }
}

}  // namespace

int main() {
  const std::string payload = MakeMalformedUnknownLengthDelimited();
  std::fprintf(stderr, "=== STATE CAPTURE: skipfield-no-length-validation ===\n");
  std::fprintf(stderr, "payload_size=%zu\n", payload.size());
  DumpBytes(payload);

  google::protobuf::io::ArrayInputStream raw_for_decode(
      payload.data(), static_cast<int>(payload.size()));
  google::protobuf::io::CodedInputStream decode_input(&raw_for_decode);
  const uint32_t decoded_tag = decode_input.ReadTag();
  uint32_t decoded_length = 0;
  const bool read_length_ok = decode_input.ReadVarint32(&decoded_length);
  std::fprintf(stderr, "[DECODE] tag=0x%x\n", decoded_tag);
  std::fprintf(stderr, "[DECODE] read_length_ok=%d\n", read_length_ok ? 1 : 0);
  std::fprintf(stderr, "[DECODE] decoded_length=%u (0x%x)\n", decoded_length,
               decoded_length);
  std::fprintf(stderr, "[DECODE] decoded_length_as_int=%d\n",
               static_cast<int>(decoded_length));
  DumpState("after manual tag+length decode", decode_input);

  google::protobuf::io::ArrayInputStream raw_for_skip(
      payload.data(), static_cast<int>(payload.size()));
  google::protobuf::io::CodedInputStream skip_input(&raw_for_skip);
  DumpState("before ReadTag", skip_input);
  const uint32_t tag = skip_input.ReadTag();
  std::fprintf(stderr, "[SKIPFIELD] tag=0x%x\n", tag);
  DumpState("after ReadTag before SkipField", skip_input);
  const bool skip_ok =
      google::protobuf::internal::WireFormatLite::SkipField(&skip_input, tag);
  std::fprintf(stderr, "[SKIPFIELD] skip_ok=%d\n", skip_ok ? 1 : 0);
  DumpState("after SkipField", skip_input);

  return skip_ok ? 0 : 1;
}
