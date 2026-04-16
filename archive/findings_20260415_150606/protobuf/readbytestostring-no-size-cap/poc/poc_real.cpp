#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/wire_format_lite.h"

namespace {

std::vector<uint8_t> EncodeVarint32(uint32_t value) {
  std::vector<uint8_t> out;
  while (value >= 0x80) {
    out.push_back(static_cast<uint8_t>(value | 0x80));
    value >>= 7;
  }
  out.push_back(static_cast<uint8_t>(value));
  return out;
}

std::vector<uint8_t> MakeBytesField(uint32_t declared_length,
                                    size_t actual_payload_size) {
  std::vector<uint8_t> wire;
  wire.push_back(0x0a);  // field 1, wire type 2
  const auto length = EncodeVarint32(declared_length);
  wire.insert(wire.end(), length.begin(), length.end());
  wire.insert(wire.end(), actual_payload_size, static_cast<uint8_t>('X'));
  return wire;
}

int32_t AsSigned32(uint32_t value) {
  return static_cast<int32_t>(value);
}

bool RunCase(const char* name, uint32_t declared_length,
             size_t actual_payload_size) {
  auto wire = MakeBytesField(declared_length, actual_payload_size);
  google::protobuf::io::CodedInputStream input(
      reinterpret_cast<const uint8_t*>(wire.data()),
      static_cast<int>(wire.size()));

  const uint32_t tag = input.ReadTag();
  std::string out = "sentinel";
  const bool ok =
      google::protobuf::internal::WireFormatLite::ReadBytes(&input, &out);

  std::cout << "case=" << name << "\n";
  std::cout << "declared_length_u32=" << declared_length << "\n";
  std::cout << "declared_length_i32=" << AsSigned32(declared_length) << "\n";
  std::cout << "actual_payload_size=" << actual_payload_size << "\n";
  std::cout << "wire_size=" << wire.size() << "\n";
  std::cout << "tag=0x" << std::hex << tag << std::dec << "\n";
  std::cout << "ok=" << (ok ? "true" : "false") << "\n";
  std::cout << "out_size=" << out.size() << "\n";
  std::cout << "consumed_all=" << (input.ConsumedEntireMessage() ? "true" : "false")
            << "\n";
  std::cout << "bytes_until_limit=" << input.BytesUntilLimit() << "\n";
  std::cout << "---" << std::endl;
  return ok;
}

}  // namespace

int main() {
  bool success = true;
  success &= RunCase("small_control", 4u, 4u);
  success &= !RunCase("int_max_truncated", std::numeric_limits<int32_t>::max(),
                      1u);
  success &= !RunCase("wraps_negative_int", 0x80000000u, 1u);
  success &= !RunCase("all_bits_set", 0xffffffffu, 1u);
  return success ? 0 : 1;
}
