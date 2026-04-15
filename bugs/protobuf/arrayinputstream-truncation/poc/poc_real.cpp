#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <sys/mman.h>

#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

namespace {

constexpr size_t kLogicalSize = static_cast<size_t>(std::numeric_limits<int>::max()) + 1;

void* ReserveLargeRegion(size_t size) {
  void* region = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (region == MAP_FAILED) return nullptr;
  return region;
}

}  // namespace

int main() {
  void* region = ReserveLargeRegion(kLogicalSize);
  if (region == nullptr) {
    std::cerr << "mmap failed for logical size " << kLogicalSize << "\n";
    return 2;
  }

  std::memset(region, 'A', 16);
  size_t oversized = kLogicalSize;

  google::protobuf::io::ArrayInputStream stream(region, oversized);

  const void* data = nullptr;
  int size = -1;
  bool ok = stream.Next(&data, &size);

  std::cout << "logical_size=" << oversized << "\n";
  std::cout << "int_truncated_size=" << static_cast<int>(oversized) << "\n";
  std::cout << "next_result=" << ok << "\n";
  std::cout << "returned_size=" << size << "\n";
  std::cout << "byte_count=" << stream.ByteCount() << "\n";

  munmap(region, kLogicalSize);

  if (ok || size != -1 || stream.ByteCount() != 0) {
    std::cerr << "unexpected behavior: reproducer assumptions invalid\n";
    return 3;
  }

  std::cerr << "LOGIC_BUG: oversized input is treated as empty after int truncation\n";
  return 0;
}
