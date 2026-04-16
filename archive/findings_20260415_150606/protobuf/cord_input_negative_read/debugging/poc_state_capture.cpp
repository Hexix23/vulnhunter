#include <cstdint>
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

void CaptureDirectNegativeRead() {
  const std::string input = "ABCDEFGH";
  google::protobuf::io::ArrayInputStream array_stream(input.data(),
                                                      input.size());
  google::protobuf::io::CodedInputStream coded_input(&array_stream);
  absl::Cord output("sentinel");

  std::cout << "[direct] before.output_size=" << output.size() << "\n";
  std::cout << "[direct] before.output_hex=" << HexEncode(output) << "\n";
  std::cout << "[direct] before.current_position="
            << coded_input.CurrentPosition() << "\n";
  std::cout << "[direct] before.bytes_until_limit="
            << coded_input.BytesUntilLimit() << "\n";

  const bool ok = coded_input.ReadCord(&output, -1);

  std::cout << "[direct] call.size=-1\n";
  std::cout << "[direct] after.ok=" << ok << "\n";
  std::cout << "[direct] after.output_size=" << output.size() << "\n";
  std::cout << "[direct] after.output_hex=" << HexEncode(output) << "\n";
  std::cout << "[direct] after.current_position="
            << coded_input.CurrentPosition() << "\n";
  std::cout << "[direct] after.bytes_until_limit="
            << coded_input.BytesUntilLimit() << "\n";
}

void CaptureVarintSizeOverflow() {
  const char payload_bytes[] = {
      static_cast<char>(0xff), static_cast<char>(0xff),
      static_cast<char>(0xff), static_cast<char>(0xff),
      static_cast<char>(0x0f), 'D', 'A', 'T', 'A'};
  const std::string payload(payload_bytes, sizeof(payload_bytes));
  google::protobuf::io::ArrayInputStream array_stream(payload.data(),
                                                      payload.size());
  google::protobuf::io::CodedInputStream coded_input(&array_stream);
  int length = 12345;

  std::cout << "[varint] encoded_bytes=ff ff ff ff 0f 44 41 54 41\n";
  std::cout << "[varint] before.current_position="
            << coded_input.CurrentPosition() << "\n";

  const bool ok = coded_input.ReadVarintSizeAsInt(&length);

  std::cout << "[varint] after.ok=" << ok << "\n";
  std::cout << "[varint] after.length=" << length << "\n";
  std::cout << "[varint] after.current_position="
            << coded_input.CurrentPosition() << "\n";
  std::cout << "[varint] after.bytes_until_limit="
            << coded_input.BytesUntilLimit() << "\n";
}

void CaptureWireFormatReadBytes() {
  const char payload_bytes[] = {
      static_cast<char>(0xff), static_cast<char>(0xff),
      static_cast<char>(0xff), static_cast<char>(0xff),
      static_cast<char>(0x0f), 'D', 'A', 'T', 'A'};
  const std::string payload(payload_bytes, sizeof(payload_bytes));
  google::protobuf::io::ArrayInputStream array_stream(payload.data(),
                                                      payload.size());
  google::protobuf::io::CodedInputStream coded_input(&array_stream);
  absl::Cord output("prefilled");

  std::cout << "[wireformat] before.output_size=" << output.size() << "\n";
  std::cout << "[wireformat] before.output_hex=" << HexEncode(output) << "\n";
  std::cout << "[wireformat] before.current_position="
            << coded_input.CurrentPosition() << "\n";

  const bool ok =
      google::protobuf::internal::WireFormatLite::ReadBytes(&coded_input,
                                                            &output);

  std::cout << "[wireformat] after.ok=" << ok << "\n";
  std::cout << "[wireformat] after.output_size=" << output.size() << "\n";
  std::cout << "[wireformat] after.output_hex=" << HexEncode(output) << "\n";
  std::cout << "[wireformat] after.current_position="
            << coded_input.CurrentPosition() << "\n";
  std::cout << "[wireformat] after.bytes_until_limit="
            << coded_input.BytesUntilLimit() << "\n";
}

}  // namespace

int main() {
  CaptureDirectNegativeRead();
  CaptureVarintSizeOverflow();
  CaptureWireFormatReadBytes();
  return 0;
}
