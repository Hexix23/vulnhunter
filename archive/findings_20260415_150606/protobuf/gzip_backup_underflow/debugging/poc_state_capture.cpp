#define private public
#include "google/protobuf/io/gzip_stream.h"
#undef private

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <zlib.h>

#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

namespace google {
namespace protobuf {
namespace internal {

struct StreamContext {
  z_stream context;
};

}  // namespace internal
}  // namespace protobuf
}  // namespace google

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
    std::fprintf(stderr, "failed to acquire gzip output buffer\n");
    std::exit(2);
  }

  std::memcpy(out, payload.data(), payload.size());
  gzip_out.BackUp(out_size - static_cast<int>(payload.size()));
  if (!gzip_out.Close()) {
    std::fprintf(stderr, "gzip close failed: %d\n", gzip_out.ZlibErrorCode());
    std::exit(3);
  }

  compressed.resize(sink.ByteCount());
  return compressed;
}

void DumpBytes(const char* label, const void* ptr, int count) {
  auto bytes = static_cast<const unsigned char*>(ptr);
  std::printf("%s", label);
  for (int i = 0; i < count; ++i) {
    std::printf("%s%02x", i == 0 ? "" : " ", bytes[i]);
  }
  std::printf("\n");
}

void PrintState(const char* label, const GzipInputStream& gzip_in) {
  auto output_buffer = reinterpret_cast<std::uintptr_t>(gzip_in.output_buffer_);
  auto output_position = reinterpret_cast<std::uintptr_t>(gzip_in.output_position_);
  auto next_out =
      reinterpret_cast<std::uintptr_t>(gzip_in.zcontext_->context.next_out);

  std::printf("[%s]\n", label);
  std::printf("  output_buffer=%p\n", gzip_in.output_buffer_);
  std::printf("  output_position=%p\n", gzip_in.output_position_);
  std::printf("  next_out=%p\n", gzip_in.zcontext_->context.next_out);
  std::printf("  output_buffer_length=%zu\n", gzip_in.output_buffer_length_);
  std::printf("  byte_count_field=%lld\n", static_cast<long long>(gzip_in.byte_count_));
  std::printf("  z_total_out=%lu\n",
              static_cast<unsigned long>(gzip_in.zcontext_->context.total_out));
  std::printf("  output_position_minus_buffer=%lld\n",
              static_cast<long long>(output_position - output_buffer));
  std::printf("  next_out_minus_output_position=%lld\n",
              static_cast<long long>(next_out - output_position));
  std::printf("  next_out_minus_buffer=%lld\n",
              static_cast<long long>(next_out - output_buffer));
  std::printf("  ByteCount()=%lld\n", static_cast<long long>(gzip_in.ByteCount()));
}

}  // namespace

int main() {
  std::setvbuf(stdout, nullptr, _IONBF, 0);
  std::setvbuf(stderr, nullptr, _IONBF, 0);

  const std::string payload = "PROTOBUF_GZIP_BACKUP";
  const std::vector<std::uint8_t> compressed = MakeCompressed(payload);

  ArrayInputStream source(compressed.data(), static_cast<int>(compressed.size()));
  GzipInputStream gzip_in(&source, GzipInputStream::GZIP, 32);

  const void* first = nullptr;
  int first_size = 0;
  if (!gzip_in.Next(&first, &first_size)) {
    std::fprintf(stderr, "initial Next() failed: %d\n", gzip_in.ZlibErrorCode());
    return 4;
  }

  PrintState("after first Next()", gzip_in);
  std::printf("  first_ptr=%p\n", first);
  std::printf("  first_size=%d\n", first_size);
  DumpBytes("  first_bytes=", first, first_size);

  const int over_backup = first_size + 32;
  gzip_in.BackUp(over_backup);

  PrintState("after oversized BackUp()", gzip_in);
  std::printf("  backup_count=%d\n", over_backup);

  const void* second = nullptr;
  int second_size = 0;
  if (!gzip_in.Next(&second, &second_size)) {
    std::fprintf(stderr, "second Next() failed unexpectedly: %d\n",
                 gzip_in.ZlibErrorCode());
    return 5;
  }

  PrintState("after second Next()", gzip_in);
  std::printf("  second_ptr=%p\n", second);
  std::printf("  second_size=%d\n", second_size);
  std::printf("  pointer_delta=%lld\n",
              static_cast<long long>(reinterpret_cast<std::uintptr_t>(first) -
                                     reinterpret_cast<std::uintptr_t>(second)));
  std::printf("  second_ptr_before_output_buffer=%d\n",
              reinterpret_cast<std::uintptr_t>(second) <
                      reinterpret_cast<std::uintptr_t>(gzip_in.output_buffer_)
                  ? 1
                  : 0);
  DumpBytes("  output_buffer_bytes=", gzip_in.output_buffer_, first_size);
  std::printf("  second_bytes_dump_skipped=1\n");

  return 0;
}
