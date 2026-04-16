#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

extern "C" {
#include "upb/mem/arena.h"
}

struct AllocationSnapshot {
  uint32_t input_size;
  void* ptr;
};

struct CastSnapshot {
  size_t output_size;
  uint32_t network_out;
};

__attribute__((noinline)) static AllocationSnapshot CaptureAllocationState() {
  AllocationSnapshot snapshot{};
  upb_Arena* arena = upb_Arena_New();
  if (arena == nullptr) {
    std::fputs("upb_Arena_New() returned NULL\n", stderr);
    std::exit(2);
  }

  snapshot.input_size = 0xffffffffu;
  snapshot.ptr = upb_Arena_Malloc(arena, snapshot.input_size);

  std::fprintf(stderr, "[allocation] input_size=%u ptr=%p\n", snapshot.input_size,
               snapshot.ptr);
  upb_Arena_Free(arena);
  return snapshot;
}

__attribute__((noinline)) static CastSnapshot CaptureCastState() {
  CastSnapshot snapshot{};
  snapshot.output_size = static_cast<size_t>(UINT32_MAX) + 0x123ULL;
  snapshot.network_out = static_cast<uint32_t>(snapshot.output_size);
  std::fprintf(stderr, "[cast] output_size=%zu network_out=%u\n",
               snapshot.output_size, snapshot.network_out);
  return snapshot;
}

int main() {
  AllocationSnapshot allocation = CaptureAllocationState();
  CastSnapshot cast = CaptureCastState();

  std::fprintf(stderr,
               "[summary] ptr=%p input_size=%u output_size=%zu network_out=%u\n",
               allocation.ptr, allocation.input_size, cast.output_size,
               cast.network_out);
  return allocation.ptr == nullptr ? 1 : 0;
}
