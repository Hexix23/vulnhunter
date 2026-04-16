#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" {
#include "upb/mem/arena.h"
}

int main() {
  constexpr uint32_t requested = 0xffffffffu;

  // The ASan bundle does not include conformance_upb/DoTestIo(), so this
  // validates the real linked allocator path that DoTestIo() reaches through
  // the shipped libupb archive.
  upb_Arena* arena = upb_Arena_New();
  if (arena == nullptr) {
    std::puts("upb_Arena_New() returned NULL");
    return 2;
  }

  void* ptr = upb_Arena_Malloc(arena, requested);
  size_t fused_count = 0;
  uintptr_t accounted = upb_Arena_SpaceAllocated(arena, &fused_count);
  std::printf("linked_libupb requested=%u ptr=%p accounted=%llu fused=%zu\n",
              requested, ptr,
              static_cast<unsigned long long>(accounted), fused_count);

  if (ptr != nullptr) {
    auto* bytes = static_cast<unsigned char*>(ptr);
    bytes[0] = 0x41;
    bytes[requested - 1] = 0x5a;
    std::printf("touch_first=%u touch_last=%u\n", bytes[0],
                bytes[requested - 1]);
  } else {
    std::puts("allocator returned NULL");
  }

  upb_Arena_Free(arena);
  return 0;
}
