#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#include "google/protobuf/io/gzip_stream.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

namespace {

using google::protobuf::io::ArrayInputStream;
using google::protobuf::io::ArrayOutputStream;
using google::protobuf::io::GzipInputStream;
using google::protobuf::io::GzipOutputStream;

std::vector<std::uint8_t> MakeCompressed(const std::string& payload) {
  std::vector<std::uint8_t> compressed(256);
  ArrayOutputStream sink(compressed.data(), static_cast<int>(compressed.size()));
  GzipOutputStream::Options options;
  options.format = GzipOutputStream::GZIP;
  options.buffer_size = 32;
  GzipOutputStream gzip_out(&sink, options);

  void* out = nullptr;
  int out_size = 0;
  if (!gzip_out.Next(&out, &out_size) || out_size < static_cast<int>(payload.size())) {
    std::cerr << "failed to acquire gzip output buffer" << std::endl;
    std::exit(2);
  }

  std::memcpy(out, payload.data(), payload.size());
  gzip_out.BackUp(out_size - static_cast<int>(payload.size()));
  if (!gzip_out.Close()) {
    std::cerr << "gzip close failed: " << gzip_out.ZlibErrorCode() << std::endl;
    std::exit(3);
  }

  compressed.resize(sink.ByteCount());
  return compressed;
}

}  // namespace

int main() {
  const std::string payload = "PROTOBUF_GZIP_BACKUP";
  const std::vector<std::uint8_t> compressed = MakeCompressed(payload);

  ArrayInputStream source(compressed.data(), static_cast<int>(compressed.size()));
  GzipInputStream gzip_in(&source, GzipInputStream::GZIP, 32);

  const void* first = nullptr;
  int first_size = 0;
  if (!gzip_in.Next(&first, &first_size)) {
    std::cerr << "initial Next() failed: " << gzip_in.ZlibErrorCode() << std::endl;
    return 4;
  }

  std::cout << "first_size=" << first_size << '\n';
  std::cout << "first_ptr=" << first << '\n';
  std::cout << "byte_count_before=" << gzip_in.ByteCount() << '\n';

  const int over_backup = first_size + 32;
  gzip_in.BackUp(over_backup);
  const auto byte_count_after_backup = gzip_in.ByteCount();

  std::cout << "backup_count=" << over_backup << '\n';
  std::cout << "byte_count_after_backup=" << byte_count_after_backup << '\n';

  const void* second = nullptr;
  int second_size = 0;
  if (!gzip_in.Next(&second, &second_size)) {
    std::cerr << "second Next() failed unexpectedly: " << gzip_in.ZlibErrorCode()
              << std::endl;
    return 5;
  }

  auto first_addr = reinterpret_cast<std::uintptr_t>(first);
  auto second_addr = reinterpret_cast<std::uintptr_t>(second);

  std::cout << "second_size=" << second_size << '\n';
  std::cout << "second_ptr=" << second << '\n';
  std::cout << "pointer_delta=" << static_cast<long long>(first_addr - second_addr)
            << '\n';
  std::cout << "byte_count_after_second_next=" << gzip_in.ByteCount() << '\n';

  const bool size_bug = second_size > first_size;
  const bool pointer_bug = second_addr < first_addr;
  const bool count_bug =
      byte_count_after_backup > static_cast<long long>(payload.size());

  std::cout << "size_bug=" << size_bug << '\n';
  std::cout << "pointer_bug=" << pointer_bug << '\n';
  std::cout << "count_bug=" << count_bug << '\n';

  if (!(size_bug && pointer_bug && count_bug)) {
    std::cerr << "backup underflow did not reproduce as expected" << std::endl;
    return 6;
  }

  return 0;
}
