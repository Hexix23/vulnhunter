#include <cstdint>
#include <cstdio>

extern "C" {
#include "upb/mem/arena.h"
}

int main() {
  constexpr uint32_t requested = 0xffffffffu;

  // Source analysis places the bug in conformance_upb.c::DoTestIo(), which
  // forwards a 32-bit frame length into upb_Arena_Malloc() without bounds
  // checks. The archived ASan build does not contain that executable, so this
  // probe exercises the real linked allocator path only.
  upb_Arena* arena = upb_Arena_New();
  if (arena == nullptr) {
    std::puts("upb_Arena_New() returned NULL");
    return 2;
  }

  void* ptr = upb_Arena_Malloc(arena, requested);
  std::printf("linked_libupb requested=%u ptr=%p\n", requested, ptr);
  std::puts(ptr == nullptr ? "allocator returned NULL"
                           : "allocator returned non-NULL");

  upb_Arena_Free(arena);
  return 0;
}
