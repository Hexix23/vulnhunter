#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <unistd.h>

extern "C" {
#include "upb/mem/arena.h"
}

int main() {
  uint32_t input_size = 0;

  std::fprintf(stderr, "=== STATE CAPTURE: protobuf-input-001 ===\n");
  ssize_t nread = read(STDIN_FILENO, &input_size, sizeof(input_size));
  std::fprintf(stderr, "[INPUT] bytes_read = %zd\n", nread);
  if (nread != sizeof(input_size)) {
    std::fprintf(stderr,
                 "[RESULT] STATE_OK: expected 4-byte advertised length on stdin\n");
    return 1;
  }

  std::fprintf(stderr, "[INPUT] advertised input_size = %" PRIu32 " (0x%08" PRIx32
                       ")\n",
               input_size, input_size);
  std::fprintf(stderr, "[INPUT] requested bytes ~= %.2f GiB\n",
               static_cast<double>(input_size) / (1024.0 * 1024.0 * 1024.0));

  upb_Arena* arena = upb_Arena_New();
  std::fprintf(stderr, "[BEFORE] arena = %p\n", static_cast<void*>(arena));
  if (arena == nullptr) {
    std::fprintf(stderr, "[RESULT] STATE_OK: upb_Arena_New() returned NULL\n");
    return 2;
  }

  std::fprintf(stderr, "[BEFORE] about_to_call = upb_Arena_Malloc(arena, %" PRIu32
                       ")\n",
               input_size);
  void* ptr = upb_Arena_Malloc(arena, input_size);
  size_t fused_count = 0;
  uintptr_t accounted = upb_Arena_SpaceAllocated(arena, &fused_count);

  std::fprintf(stderr, "[AFTER] ptr = %p\n", ptr);
  std::fprintf(stderr, "[AFTER] accounted = %" PRIuPTR " (0x%" PRIxPTR ")\n",
               accounted, accounted);
  std::fprintf(stderr, "[AFTER] fused_count = %zu\n", fused_count);

  if (ptr != nullptr) {
    auto* bytes = static_cast<unsigned char*>(ptr);
    bytes[0] = 0x41;
    bytes[input_size - 1] = 0x5a;
    std::fprintf(stderr, "[TOUCH] first byte @ %p = 0x%02x\n",
                 static_cast<void*>(&bytes[0]), bytes[0]);
    std::fprintf(stderr, "[TOUCH] last byte  @ %p = 0x%02x\n",
                 static_cast<void*>(&bytes[input_size - 1]),
                 bytes[input_size - 1]);
    std::fprintf(stderr,
                 "[RESULT] STATE_BUG: untrusted 32-bit length reached "
                 "upb_Arena_Malloc() unchecked and produced a writable "
                 "allocation/accounting span of %" PRIuPTR " bytes\n",
                 accounted);
  } else {
    std::fprintf(stderr,
                 "[RESULT] STATE_OK: allocator rejected the oversized request\n");
  }

  upb_Arena_Free(arena);
  return 0;
}
