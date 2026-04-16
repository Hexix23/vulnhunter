#include <cstdint>
#include <cstdio>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

#include "absl/strings/cord.h"
#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"
#include "google/protobuf/wire_format_lite.h"

namespace {

std::string HexEncode(const absl::Cord& cord) {
  std::string flat = std::string(cord);
  std::ostringstream out;
  out << std::hex << std::setfill('0');
  for (unsigned char c : flat) {
    out << std::setw(2) << static_cast<int>(c);
  }
  return out.str();
}

void ExerciseDirectNegativeRead() {
  const std::string input = "ABCDEFGH";
  google::protobuf::io::ArrayInputStream array_stream(input.data(),
                                                      input.size());
  google::protobuf::io::CodedInputStream coded_input(&array_stream);
  absl::Cord output("sentinel");

  const bool ok = coded_input.ReadCord(&output, -1);
  std::cout << "direct_negative_read.ok=" << ok << "\n";
  std::cout << "direct_negative_read.output_size=" << output.size() << "\n";
  std::cout << "direct_negative_read.output_hex=" << HexEncode(output) << "\n";
  std::cout << "direct_negative_read.bytes_until_limit="
            << coded_input.BytesUntilLimit() << "\n";
}

void ExerciseLengthPrefixedCordRead() {
  // Field payload: varint length encoded as uint32 max, which overflows int.
  const char payload_bytes[] = {
      static_cast<char>(0xff), static_cast<char>(0xff),
      static_cast<char>(0xff), static_cast<char>(0xff),
      static_cast<char>(0x0f), 'D', 'A', 'T', 'A'};
  const std::string payload(payload_bytes, sizeof(payload_bytes));
  google::protobuf::io::ArrayInputStream array_stream(payload.data(),
                                                      payload.size());
  google::protobuf::io::CodedInputStream coded_input(&array_stream);
  absl::Cord output("prefilled");

  const bool ok =
      google::protobuf::internal::WireFormatLite::ReadBytes(&coded_input,
                                                            &output);
  std::cout << "wireformat_readbytes.ok=" << ok << "\n";
  std::cout << "wireformat_readbytes.output_size=" << output.size() << "\n";
  std::cout << "wireformat_readbytes.output_hex=" << HexEncode(output) << "\n";
  std::cout << "wireformat_readbytes.current_position="
            << coded_input.CurrentPosition() << "\n";
}

}  // namespace

int main() {
  ExerciseDirectNegativeRead();
  ExerciseLengthPrefixedCordRead();
  return 0;
}
