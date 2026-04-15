#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"
#include "google/protobuf/wire_format_lite.h"

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

  // Deliberately claim a large body without providing it. This exercises the
  // length-delimited unknown-field path in the compiled parser.
  AppendVarint(0x7ffffff0u, &payload);
  payload.append("ABC", 3);
  return payload;
}

}  // namespace

int main() {
  const std::string payload = MakeMalformedUnknownLengthDelimited();
  google::protobuf::io::ArrayInputStream raw_input(
      payload.data(), static_cast<int>(payload.size()));
  google::protobuf::io::CodedInputStream input(&raw_input);

  std::fprintf(stderr, "payload_size=%zu\n", payload.size());
  const uint32_t tag = input.ReadTag();
  std::fprintf(stderr, "tag=0x%x\n", tag);
  const bool ok = google::protobuf::internal::WireFormatLite::SkipField(&input,
                                                                         tag);
  std::fprintf(stderr, "skip_ok=%d\n", ok ? 1 : 0);
  std::fprintf(stderr, "bytes_until_limit=%d\n", input.BytesUntilLimit());
  return ok ? 0 : 1;
}
