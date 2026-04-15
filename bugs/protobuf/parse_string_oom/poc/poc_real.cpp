#include <cstdint>
#include <iomanip>
#include <iostream>
#include <string>

#include "google/protobuf/any.pb.h"

namespace {

std::string MakeOversizedStringFieldPayload() {
  std::string payload;

  // Field 1 of google.protobuf.Any is `type_url` with wire type 2.
  payload.push_back(static_cast<char>(0x0A));

  // Length varint for 1 GiB: 0x40000000 => 0x80 0x80 0x80 0x80 0x04.
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x80));
  payload.push_back(static_cast<char>(0x04));

  // Intentionally provide only a few bytes so parsing must fail on bounds,
  // not on an allocator crash.
  payload.append("ABC", 3);
  return payload;
}

}  // namespace

int main() {
  GOOGLE_PROTOBUF_VERIFY_VERSION;

  const std::string payload = MakeOversizedStringFieldPayload();
  google::protobuf::Any message;

  std::cerr << "payload_size=" << payload.size() << "\n";
  const bool ok = message.ParseFromString(payload);
  std::cerr << std::boolalpha;
  std::cerr << "parse_ok=" << ok << "\n";
  std::cerr << "type_url_size=" << message.type_url().size() << "\n";
  if (!message.type_url().empty()) {
    std::cerr << "type_url_prefix=" << message.type_url().substr(0, 16) << "\n";
  }

  google::protobuf::ShutdownProtobufLibrary();
  return ok ? 0 : 1;
}
