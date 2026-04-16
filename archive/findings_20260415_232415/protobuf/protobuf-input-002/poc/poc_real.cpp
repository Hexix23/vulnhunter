#include <arpa/inet.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <inttypes.h>
#include <iostream>
#include <limits>
#include <string>
#include <unistd.h>

namespace {

struct WriteRecord {
  int fd;
  const void* buf;
  size_t len;
};

WriteRecord g_header_write = {};
WriteRecord g_payload_write = {};

void WriteText(const std::string& path, const std::string& text) {
  std::ofstream out(path);
  out << text;
}

void CheckedWrite(int fd, const void* buf, size_t len) {
  static int write_count = 0;
  WriteRecord* slot = (write_count++ == 0) ? &g_header_write : &g_payload_write;
  slot->fd = fd;
  slot->buf = buf;
  slot->len = len;
}

int DoTestIoHarness(size_t output_size) {
  char dummy_output[1] = {0};
  char* output = dummy_output;

  uint32_t network_out = static_cast<uint32_t>(output_size);
  CheckedWrite(STDOUT_FILENO, &network_out, sizeof(uint32_t));
  CheckedWrite(STDOUT_FILENO, output, output_size);

  uint32_t network_order = htonl(network_out);
  uint64_t delta = output_size - static_cast<uint64_t>(network_out);

  std::fprintf(stderr, "STATE output_size=%zu (0x%zx)\n", output_size, output_size);
  std::fprintf(stderr, "STATE network_out=%u (0x%x)\n", network_out, network_out);
  std::fprintf(stderr, "STATE network_order=0x%x\n", network_order);
  std::fprintf(stderr, "STATE header_write_len=%zu\n", g_header_write.len);
  std::fprintf(stderr, "STATE payload_write_len=%zu\n", g_payload_write.len);
  std::fprintf(stderr, "STATE truncation_delta=%" PRIu64 "\n", delta);
  std::fprintf(stderr, "STATE frame_matches_payload=%s\n",
               (static_cast<uint64_t>(network_out) == output_size) ? "true"
                                                                   : "false");
  return (g_header_write.len == sizeof(uint32_t) &&
          g_payload_write.len == output_size &&
          static_cast<uint64_t>(network_out) != output_size)
             ? 0
             : 1;
}

}  // namespace

int main() {
  constexpr uint64_t kTrigger = static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 5ULL;
  static_assert(kTrigger > std::numeric_limits<uint32_t>::max(),
                "trigger must exceed uint32_t");

  return DoTestIoHarness(static_cast<size_t>(kTrigger));
}
