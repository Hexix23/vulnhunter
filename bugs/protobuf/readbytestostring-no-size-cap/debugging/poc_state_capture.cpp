#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include "google/protobuf/io/coded_stream.h"

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
  wire.push_back(0x0a);
  const auto length = EncodeVarint32(declared_length);
  wire.insert(wire.end(), length.begin(), length.end());
  wire.insert(wire.end(), actual_payload_size, static_cast<uint8_t>('X'));
  return wire;
}

int32_t AsSigned32(uint32_t value) { return static_cast<int32_t>(value); }

void DumpWirePrefix(const std::vector<uint8_t>& wire) {
  std::cout << "wire_prefix=";
  for (size_t i = 0; i < wire.size() && i < 8; ++i) {
    if (i != 0) std::cout << ' ';
    std::cout << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<unsigned>(wire[i]);
  }
  std::cout << std::dec << "\n";
}

void CaptureCase(const char* name, uint32_t declared_length,
                 size_t actual_payload_size) {
  auto wire = MakeBytesField(declared_length, actual_payload_size);
  google::protobuf::io::CodedInputStream input(
      reinterpret_cast<const uint8_t*>(wire.data()),
      static_cast<int>(wire.size()));

  std::string out = "sentinel";
  const uint32_t tag = input.ReadTag();
  uint32_t length = 0;
  const bool read_varint_ok = input.ReadVarint32(&length);

  std::cout << "case=" << name << "\n";
  std::cout << "tag=0x" << std::hex << tag << std::dec << "\n";
  std::cout << "declared_length_u32=" << declared_length << "\n";
  std::cout << "declared_length_i32=" << AsSigned32(declared_length) << "\n";
  std::cout << "wire_size=" << wire.size() << "\n";
  DumpWirePrefix(wire);
  std::cout << "read_varint_ok=" << (read_varint_ok ? "true" : "false") << "\n";
  std::cout << "decoded_length_u32=" << length << "\n";
  std::cout << "decoded_length_i32=" << AsSigned32(length) << "\n";
  std::cout << "bytes_until_limit_before_readstring=" << input.BytesUntilLimit()
            << "\n";
  std::cout << "current_position_before_readstring=" << input.CurrentPosition()
            << "\n";
  std::cout << "out_size_before_readstring=" << out.size() << "\n";

  const bool read_string_ok = input.ReadString(&out, static_cast<int>(length));

  std::cout << "read_string_ok=" << (read_string_ok ? "true" : "false") << "\n";
  std::cout << "out_size_after_readstring=" << out.size() << "\n";
  std::cout << "bytes_until_limit_after_readstring=" << input.BytesUntilLimit()
            << "\n";
  std::cout << "current_position_after_readstring=" << input.CurrentPosition()
            << "\n";
  std::cout << "consumed_all=" << (input.ConsumedEntireMessage() ? "true" : "false")
            << "\n";
  std::cout << "---\n";
}

}  // namespace

int main() {
  CaptureCase("small_control", 4u, 4u);
  CaptureCase("int_max_truncated", std::numeric_limits<int32_t>::max(), 1u);
  CaptureCase("wraps_negative_int", 0x80000000u, 1u);
  CaptureCase("all_bits_set", 0xffffffffu, 1u);
  return 0;
}
