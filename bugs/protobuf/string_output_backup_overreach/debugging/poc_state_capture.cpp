#include <cstddef>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>

#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

namespace {

void FillBuffer(void* data, int size, char value) {
  std::memset(data, static_cast<unsigned char>(value), static_cast<size_t>(size));
}

void DumpBytes(const std::string& label, const std::string& buffer, size_t count) {
  std::cout << label << " [0.." << (count == 0 ? 0 : count - 1) << "] =";
  const unsigned char* data =
      reinterpret_cast<const unsigned char*>(buffer.data());
  for (size_t i = 0; i < count; ++i) {
    std::cout << ' ' << std::setw(2) << std::setfill('0') << std::hex
              << static_cast<unsigned int>(data[i]);
  }
  std::cout << std::dec << '\n';
}

void DumpWindow(const std::string& label, const std::string& buffer, size_t begin,
                size_t end) {
  std::cout << label << " [" << begin << ".." << end << "] =";
  const unsigned char* data =
      reinterpret_cast<const unsigned char*>(buffer.data());
  for (size_t i = begin; i <= end; ++i) {
    std::cout << " (" << i << ':' << static_cast<char>(data[i]) << "/0x"
              << std::setw(2) << std::setfill('0') << std::hex
              << static_cast<unsigned int>(data[i]) << std::dec << ')';
  }
  std::cout << '\n';
}

}  // namespace

int main() {
  using google::protobuf::io::StringOutputStream;

  std::string target;
  target.reserve(64);
  StringOutputStream output(&target);

  void* first = nullptr;
  int first_size = 0;
  if (!output.Next(&first, &first_size)) return 2;
  FillBuffer(first, first_size, 'A');
  output.BackUp(32);

  void* second = nullptr;
  int second_size = 0;
  if (!output.Next(&second, &second_size)) return 3;
  FillBuffer(second, second_size, 'B');

  const size_t size_before_overreach = target.size();
  const size_t first_live_bytes =
      size_before_overreach - static_cast<size_t>(second_size);
  const int overreach = second_size + 8;

  std::cout << "first_size=" << first_size << '\n';
  std::cout << "second_size=" << second_size << '\n';
  std::cout << "first_live_bytes=" << first_live_bytes << '\n';
  std::cout << "size_before_overreach=" << size_before_overreach << '\n';
  std::cout << "byte_count_before_overreach=" << output.ByteCount() << '\n';
  std::cout << "capacity_before_overreach=" << target.capacity() << '\n';
  std::cout << "overreach_request=" << overreach << '\n';
  std::cout << "live_prefix_before=" << std::quoted(target.substr(0, target.size()))
            << '\n';
  DumpWindow("boundary_bytes_before", target, first_live_bytes - 8,
             first_live_bytes + 8);
  DumpBytes("raw_bytes_before", target, size_before_overreach);

  output.BackUp(overreach);

  std::cout << "size_after_overreach=" << target.size() << '\n';
  std::cout << "byte_count_after_overreach=" << output.ByteCount() << '\n';
  std::cout << "capacity_after_overreach=" << target.capacity() << '\n';
  std::cout << "live_prefix_after=" << std::quoted(target.substr(0, target.size()))
            << '\n';
  DumpWindow("boundary_bytes_after", target, target.size() - 8, target.size() + 8);
  DumpBytes("raw_bytes_after", target, size_before_overreach);

  return 0;
}
