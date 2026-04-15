#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>

#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

namespace {

void FillBuffer(void* data, int size, char value) {
  std::memset(data, static_cast<unsigned char>(value), static_cast<size_t>(size));
}

}  // namespace

int main() {
  using google::protobuf::io::StringOutputStream;

  std::string target;
  target.reserve(64);
  StringOutputStream output(&target);

  void* first = nullptr;
  int first_size = 0;
  if (!output.Next(&first, &first_size)) {
    std::cerr << "first Next() failed\n";
    return 2;
  }
  FillBuffer(first, first_size, 'A');
  output.BackUp(32);

  void* second = nullptr;
  int second_size = 0;
  if (!output.Next(&second, &second_size)) {
    std::cerr << "second Next() failed\n";
    return 3;
  }
  FillBuffer(second, second_size, 'B');

  const size_t size_before_overreach = target.size();
  const size_t first_live_bytes = size_before_overreach - static_cast<size_t>(second_size);
  const int overreach = second_size + 8;

  std::cout << "first_size=" << first_size << '\n';
  std::cout << "second_size=" << second_size << '\n';
  std::cout << "size_before_overreach=" << size_before_overreach << '\n';
  std::cout << "byte_count_before_overreach=" << output.ByteCount() << '\n';
  std::cout << "overreach_request=" << overreach << '\n';

  // This exceeds the last Next() span by 8 bytes while remaining <= target size.
  output.BackUp(overreach);

  std::cout << "size_after_overreach=" << target.size() << '\n';
  std::cout << "byte_count_after_overreach=" << output.ByteCount() << '\n';
  std::cout << "prefix_after_overreach="
            << std::quoted(target.substr(0, target.size())) << '\n';

  if (second_size <= 8) {
    std::cerr << "second_size too small to demonstrate overreach="
              << second_size << '\n';
    return 4;
  }
  if (target.size() != first_live_bytes - 8) {
    std::cerr << "unexpected final size=" << target.size() << '\n';
    return 5;
  }
  if (target != std::string(target.size(), 'A')) {
    std::cerr << "unexpected final contents\n";
    return 6;
  }

  std::cout << "LOGIC_BUG: BackUp(" << overreach << ") retracted 8 bytes "
            << "beyond the last " << second_size
            << "-byte buffer without any ASan finding.\n";
  return 0;
}
