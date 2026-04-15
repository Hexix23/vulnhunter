#include <algorithm>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>

#include "absl/strings/cord.h"

#define private public
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"
#undef private

namespace {

using google::protobuf::io::CordOutputStream;

const char* StateName(CordOutputStream::State state) {
  switch (state) {
    case CordOutputStream::State::kEmpty:
      return "kEmpty";
    case CordOutputStream::State::kFull:
      return "kFull";
    case CordOutputStream::State::kPartial:
      return "kPartial";
    case CordOutputStream::State::kSteal:
      return "kSteal";
  }
  return "unknown";
}

void DumpBytes(const char* label, const void* ptr, int count) {
  const auto* bytes = static_cast<const unsigned char*>(ptr);
  std::cout << "[BYTES] " << label << " @ " << ptr << " =";
  for (int i = 0; i < count; ++i) {
    std::cout << ' ' << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<unsigned int>(bytes[i]);
  }
  std::cout << std::dec << "\n";
}

void DumpState(const char* label, const CordOutputStream& output) {
  const auto buffer_length = static_cast<unsigned long>(output.buffer_.length());
  const auto buffer_capacity =
      static_cast<unsigned long>(output.buffer_.capacity());
  std::cout << "[STATE] " << label << "\n";
  std::cout << "  ByteCount()=" << output.ByteCount() << "\n";
  std::cout << "  cord_.size()=" << output.cord_.size() << "\n";
  std::cout << "  buffer_.length()=" << buffer_length << "\n";
  std::cout << "  buffer_.capacity()=" << buffer_capacity << "\n";
  std::cout << "  buffer_.slack()="
            << (buffer_capacity >= buffer_length ? buffer_capacity - buffer_length
                                                 : 0)
            << "\n";
  std::cout << "  state_=" << static_cast<int>(output.state_) << " ("
            << StateName(output.state_) << ")\n";
}

}  // namespace

int main(int argc, char** argv) {
  const bool do_consume = argc > 1 && std::string(argv[1]) == "--consume";

  CordOutputStream output(8);
  DumpState("after construction", output);

  void* first = nullptr;
  int first_size = 0;
  if (!output.Next(&first, &first_size)) {
    std::cerr << "first Next() failed\n";
    return 2;
  }
  std::memset(first, 'A', static_cast<size_t>(first_size));
  DumpState("after first Next()", output);
  DumpBytes("first chunk", first, std::min(first_size, 8));

  void* second = nullptr;
  int second_size = 0;
  if (!output.Next(&second, &second_size)) {
    std::cerr << "second Next() failed\n";
    return 3;
  }
  std::memset(second, 'B', static_cast<size_t>(second_size));
  DumpState("after second Next()", output);
  DumpBytes("second chunk", second, std::min(second_size, 8));

  const int overreach = second_size + 4;
  const auto* base = output.buffer_.data();
  const auto second_offset =
      static_cast<long>(static_cast<char*>(second) - base);
  std::cout << "[CHECK] second_size=" << second_size << "\n";
  std::cout << "[CHECK] second_offset_in_buffer=" << second_offset << "\n";
  std::cout << "[CHECK] last_next_end_offset="
            << (second_offset + second_size) << "\n";
  std::cout << "[CHECK] overreach=" << overreach << "\n";
  std::cout << "[CHECK] overreach > second_size = " << (overreach > second_size)
            << "\n";
  std::cout << "[CHECK] overreach > buffer_.length() = "
            << (overreach > static_cast<int>(output.buffer_.length())) << "\n";
  std::cout << "[CHECK] overreach <= ByteCount() = "
            << (overreach <= output.ByteCount()) << "\n";
  std::cout << "[CHECK] bytes removed before second chunk = "
            << (overreach - second_size) << "\n";
  DumpBytes("buffer before BackUp", output.buffer_.data(),
            std::min(static_cast<int>(output.buffer_.length()), 15));

  output.BackUp(overreach);
  DumpState("after BackUp(overreach)", output);
  DumpBytes("buffer after BackUp", output.buffer_.data(),
            std::min(static_cast<int>(output.buffer_.length()), 8));

  if (!do_consume) {
    std::cout << "[INFO] stopping before Consume(); rerun with --consume to "
                 "trigger the original crash path.\n";
    return 0;
  }

  std::cout << "[INFO] entering Consume()\n";
  absl::Cord result = output.Consume();
  std::string flattened(result);
  std::cout << "[RESULT] size=" << flattened.size() << "\n";
  std::cout << "[RESULT] prefix=" << flattened.substr(0, 16) << "\n";
  return 0;
}
