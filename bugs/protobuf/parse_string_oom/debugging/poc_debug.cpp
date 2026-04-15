#include <climits>
#include <cstdint>
#include <cstdio>
#include <string>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

using google::protobuf::io::ArrayInputStream;
using google::protobuf::io::CodedInputStream;

namespace {

std::string MakePayload() {
  std::string payload;
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x04));
  payload.append("ABC", 3);
  return payload;
}

struct Snapshot {
  uint32_t parsed_length;
  int current_position_before_read;
  int bytes_until_limit_before_read;
  int bytes_until_total_limit_before_read;
  bool read_ok;
  int current_position_after_read;
  int bytes_until_limit_after_read;
  int bytes_until_total_limit_after_read;
  size_t output_size;
  size_t output_capacity;
  std::string output_bytes;
  int overflow_limit_old;
  int overflow_current_position;
  int overflow_limit_after_push;
};

Snapshot RunScenario() {
  const std::string payload = MakePayload();
  ArrayInputStream array_input(payload.data(), static_cast<int>(payload.size()));
  CodedInputStream input(&array_input);

  Snapshot snapshot{};
  std::string out = "seed";

  snapshot.parsed_length = 0;
  const bool length_ok = input.ReadVarint32(&snapshot.parsed_length);
  if (!length_ok) {
    std::fprintf(stderr, "ReadVarint32 failed\n");
    snapshot.read_ok = false;
    return snapshot;
  }

  snapshot.current_position_before_read = input.CurrentPosition();
  snapshot.bytes_until_limit_before_read = input.BytesUntilLimit();
  snapshot.bytes_until_total_limit_before_read = input.BytesUntilTotalBytesLimit();
  snapshot.read_ok = input.ReadString(&out, static_cast<int>(snapshot.parsed_length));
  snapshot.current_position_after_read = input.CurrentPosition();
  snapshot.bytes_until_limit_after_read = input.BytesUntilLimit();
  snapshot.bytes_until_total_limit_after_read = input.BytesUntilTotalBytesLimit();
  snapshot.output_size = out.size();
  snapshot.output_capacity = out.capacity();
  snapshot.output_bytes = out;

  ArrayInputStream overflow_input(payload.data(), static_cast<int>(payload.size()));
  CodedInputStream overflow_stream(&overflow_input);
  const bool skip_ok = overflow_stream.Skip(5);
  if (!skip_ok) {
    std::fprintf(stderr, "Skip failed\n");
  }
  snapshot.overflow_limit_old = overflow_stream.PushLimit(INT_MAX);
  snapshot.overflow_current_position = overflow_stream.CurrentPosition();
  snapshot.overflow_limit_after_push = overflow_stream.BytesUntilLimit();

  return snapshot;
}

}  // namespace

int main() {
  const Snapshot snapshot = RunScenario();
  std::fprintf(stderr, "parsed_length=%u\n", snapshot.parsed_length);
  std::fprintf(stderr, "current_position_before_read=%d\n",
               snapshot.current_position_before_read);
  std::fprintf(stderr, "bytes_until_limit_before_read=%d\n",
               snapshot.bytes_until_limit_before_read);
  std::fprintf(stderr, "bytes_until_total_limit_before_read=%d\n",
               snapshot.bytes_until_total_limit_before_read);
  std::fprintf(stderr, "read_ok=%s\n", snapshot.read_ok ? "true" : "false");
  std::fprintf(stderr, "current_position_after_read=%d\n",
               snapshot.current_position_after_read);
  std::fprintf(stderr, "bytes_until_limit_after_read=%d\n",
               snapshot.bytes_until_limit_after_read);
  std::fprintf(stderr, "bytes_until_total_limit_after_read=%d\n",
               snapshot.bytes_until_total_limit_after_read);
  std::fprintf(stderr, "output_size=%zu\n", snapshot.output_size);
  std::fprintf(stderr, "output_capacity=%zu\n", snapshot.output_capacity);
  std::fprintf(stderr, "output_hex=");
  for (unsigned char ch : snapshot.output_bytes) {
    std::fprintf(stderr, "%02x", ch);
  }
  std::fprintf(stderr, "\n");
  std::fprintf(stderr, "overflow_limit_old=%d\n", snapshot.overflow_limit_old);
  std::fprintf(stderr, "overflow_current_position=%d\n",
               snapshot.overflow_current_position);
  std::fprintf(stderr, "overflow_limit_after_push=%d\n",
               snapshot.overflow_limit_after_push);
  return 0;
}
