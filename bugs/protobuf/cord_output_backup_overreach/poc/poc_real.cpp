#include <cstring>
#include <iostream>
#include <string>

#include "absl/strings/cord.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

int main() {
  using google::protobuf::io::CordOutputStream;

  CordOutputStream output(8);

  void* first = nullptr;
  int first_size = 0;
  if (!output.Next(&first, &first_size)) {
    std::cerr << "first Next() failed\n";
    return 2;
  }
  std::memset(first, 'A', static_cast<size_t>(first_size));

  void* second = nullptr;
  int second_size = 0;
  if (!output.Next(&second, &second_size)) {
    std::cerr << "second Next() failed\n";
    return 3;
  }
  std::memset(second, 'B', static_cast<size_t>(second_size));

  const int overreach = second_size + 4;
  std::cout << "first_next_size=" << first_size << "\n";
  std::cout << "second_next_size=" << second_size << "\n";
  std::cout << "byte_count_before_backup=" << output.ByteCount() << "\n";
  std::cout << "backup_request=" << overreach << "\n";

  // Intentionally exceed the most recent Next() result by 4 bytes.
  output.BackUp(overreach);

  absl::Cord result = output.Consume();
  std::string flattened(result);
  std::cout << "result_size=" << flattened.size() << "\n";
  std::cout << "result_prefix=" << flattened.substr(0, 16) << "\n";
  return 0;
}
