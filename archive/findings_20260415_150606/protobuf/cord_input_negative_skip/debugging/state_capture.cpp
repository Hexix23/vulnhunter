#include <cstddef>
#include <cstdint>
#include <iomanip>
#include <iostream>

#include "absl/strings/cord.h"

#define private public
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"
#undef private

namespace {

void DumpState(const char* label,
               const google::protobuf::io::CordInputStream& stream) {
  std::cout << "[" << label << "]\n";
  std::cout << "  size_=" << stream.size_ << "\n";
  std::cout << "  available_=" << stream.available_ << "\n";
  std::cout << "  bytes_remaining_=" << stream.bytes_remaining_ << "\n";
  std::cout << "  byte_count=" << stream.ByteCount() << "\n";
  std::cout << "  data_ptr=" << static_cast<const void*>(stream.data_) << "\n";

  std::cout << "  first_bytes=";
  if (stream.data_ != nullptr && stream.size_ != 0) {
    const size_t count = stream.size_ < 8 ? stream.size_ : 8;
    for (size_t i = 0; i < count; ++i) {
      if (i != 0) std::cout << " ";
      const unsigned value =
          static_cast<unsigned>(static_cast<unsigned char>(stream.data_[i]));
      std::cout << "0x" << std::hex << std::setw(2) << std::setfill('0')
                << value;
    }
    std::cout << std::dec << std::setfill(' ');
  } else {
    std::cout << "<none>";
  }
  std::cout << "\n";
}

}  // namespace

int main() {
  static constexpr char kPayload[] = "firstsecondthird";
  absl::Cord cord = absl::MakeCordFromExternal(
      kPayload, [](absl::string_view) {});

  google::protobuf::io::CordInputStream stream(&cord);
  const int skip_count = -1;
  const size_t widened_skip = static_cast<size_t>(skip_count);

  std::cout << "cord_size=" << cord.size() << "\n";
  std::cout << "skip_count=" << skip_count << "\n";
  std::cout << "skip_count_as_size_t=" << widened_skip << "\n";
  std::cout << "within_available_before="
            << (widened_skip <= stream.available_) << "\n";
  std::cout << "within_remaining_before="
            << (widened_skip <= stream.bytes_remaining_) << "\n";

  DumpState("before_skip", stream);
  const bool skip_ok = stream.Skip(skip_count);
  DumpState("after_skip", stream);

  const void* next_data = nullptr;
  int next_size = -1;
  const bool next_ok = stream.Next(&next_data, &next_size);

  std::cout << "skip_return=" << skip_ok << "\n";
  std::cout << "next_after_skip=" << next_ok << "\n";
  std::cout << "next_size=" << next_size << "\n";
  std::cout << "next_data=" << next_data << "\n";
  return 0;
}
