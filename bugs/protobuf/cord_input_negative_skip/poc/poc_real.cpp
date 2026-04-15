#include <iostream>
#include <string>

#include "absl/strings/cord.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

int main() {
  static constexpr char kPayload[] = "firstsecondthird";
  absl::Cord cord = absl::MakeCordFromExternal(
      kPayload, [](absl::string_view) {});

  google::protobuf::io::CordInputStream stream(&cord);
  const auto before = stream.ByteCount();
  const auto total = static_cast<long long>(cord.size());

  const bool ok = stream.Skip(-1);
  const auto after = stream.ByteCount();

  const void* data = nullptr;
  int size = -1;
  const bool next_ok = stream.Next(&data, &size);

  std::cout << "cord_size=" << total << "\n";
  std::cout << "byte_count_before=" << before << "\n";
  std::cout << "skip_return=" << ok << "\n";
  std::cout << "byte_count_after=" << after << "\n";
  std::cout << "next_after_skip=" << next_ok << "\n";
  std::cout << "next_size=" << size << "\n";

  if (ok) {
    std::cerr << "unexpected: negative skip returned true\n";
    return 2;
  }
  if (after != total) {
    std::cerr << "unexpected: stream did not consume the full cord\n";
    return 3;
  }
  if (next_ok) {
    std::cerr << "unexpected: stream still had data after negative skip\n";
    return 4;
  }

  return 0;
}
