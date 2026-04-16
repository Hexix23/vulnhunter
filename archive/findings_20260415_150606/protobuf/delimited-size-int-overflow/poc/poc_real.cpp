#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <vector>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

namespace {

std::vector<std::uint8_t> MakeInput() {
  // Varint for 0x80000000. The delimited parser reads this as uint32_t and
  // narrows it to int before calling PushLimit().
  std::vector<std::uint8_t> bytes = {
      0x80, 0x80, 0x80, 0x80, 0x08,
      0xde, 0xad, 0xbe, 0xef, 0x41, 0x42, 0x43, 0x44,
  };
  return bytes;
}

void DumpBytes(const std::vector<std::uint8_t>& bytes) {
  std::cout << "input_hex=";
  for (std::size_t i = 0; i < bytes.size(); ++i) {
    if (i != 0) std::cout << ' ';
    std::cout << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<unsigned int>(bytes[i]);
  }
  std::cout << std::dec << '\n';
}

}  // namespace

int main() {
  const std::vector<std::uint8_t> bytes = MakeInput();
  DumpBytes(bytes);

  google::protobuf::io::ArrayInputStream raw_input(
      bytes.data(), static_cast<int>(bytes.size()));
  google::protobuf::io::CodedInputStream coded_input(&raw_input);

  std::uint32_t size = 0;
  if (!coded_input.ReadVarint32(&size)) {
    std::cerr << "failed_to_read_size\n";
    return 1;
  }

  const int position_after_size = coded_input.CurrentPosition();
  const int narrowed_size = static_cast<int>(size);
  const auto old_limit = coded_input.PushLimit(narrowed_size);
  const int bytes_until_limit = coded_input.BytesUntilLimit();
  const int bytes_remaining = static_cast<int>(bytes.size()) - position_after_size;
  const bool skipped_remaining = coded_input.Skip(bytes_remaining);
  const int final_position = coded_input.CurrentPosition();
  coded_input.PopLimit(old_limit);

  std::cout << "size_u32=" << size << '\n';
  std::cout << "size_hex=0x" << std::hex << size << std::dec << '\n';
  std::cout << "narrowed_size_i32=" << narrowed_size << '\n';
  std::cout << "int_max=" << std::numeric_limits<int>::max() << '\n';
  std::cout << "position_after_size=" << position_after_size << '\n';
  std::cout << "bytes_remaining=" << bytes_remaining << '\n';
  std::cout << "bytes_until_limit_after_push=" << bytes_until_limit << '\n';
  std::cout << "skip_remaining_succeeded=" << (skipped_remaining ? "true" : "false")
            << '\n';
  std::cout << "final_position=" << final_position << '\n';

  if (narrowed_size < 0 && bytes_until_limit == -1 && skipped_remaining &&
      final_position == static_cast<int>(bytes.size())) {
    std::cout << "evidence=overflowed size disables PushLimit enforcement in "
                 "the real library\n";
    return 2;
  }

  std::cout << "evidence=overflow behavior not reproduced\n";
  return 0;
}
