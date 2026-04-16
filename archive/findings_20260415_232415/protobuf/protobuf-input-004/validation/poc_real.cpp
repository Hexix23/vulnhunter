#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string>

#include "upb/mem/arena.h"
#include "upb/reflection/internal/desc_state.h"

namespace {

constexpr size_t kActualAlloc = 64;
constexpr size_t kClaimedBufSize = 64;
constexpr uintptr_t kLogicalUsed =
    static_cast<uintptr_t>(std::numeric_limits<int>::max()) + 32u;

int Run(bool attempt_write) {
  upb_Arena* arena = upb_Arena_New();
  if (!arena) {
    std::fprintf(stderr, "failed: upb_Arena_New()\n");
    return 2;
  }

  upb_DescState state;
  _upb_DescState_Init(&state);

  state.bufsize = kClaimedBufSize;
  state.buf = static_cast<char*>(upb_Arena_Malloc(arena, kActualAlloc));
  if (!state.buf) {
    std::fprintf(stderr, "failed: upb_Arena_Malloc(%zu)\n", kActualAlloc);
    upb_Arena_Free(arena);
    return 2;
  }

  std::memset(state.buf, 'A', kActualAlloc);
  state.e.end = state.buf + state.bufsize;

  // Simulate a descriptor scratch buffer that has logically advanced beyond
  // INT_MAX bytes. This is the condition required for the signed truncation.
  state.ptr = reinterpret_cast<char*>(reinterpret_cast<uintptr_t>(state.buf) +
                                      kLogicalUsed);

  const ptrdiff_t used64 = state.ptr - state.buf;
  const int used32 = state.ptr - state.buf;
  const size_t remaining_if_64 = state.bufsize - static_cast<size_t>(used64);
  const size_t remaining_if_32 = state.bufsize - static_cast<size_t>(used32);

  std::printf("logical_used_64=%lld\n", static_cast<long long>(used64));
  std::printf("truncated_used_32=%d\n", used32);
  std::printf("old_bufsize=%zu\n", state.bufsize);
  std::printf("remaining_with_64bit_math=%zu\n", remaining_if_64);
  std::printf("remaining_with_truncated_math=%zu\n", remaining_if_32);
  std::printf("min_required=%d\n", kUpb_MtDataEncoder_MinSize);

  const char* before_buf = state.buf;
  const char* before_ptr = state.ptr;
  const size_t before_size = state.bufsize;

  const bool ok = _upb_DescState_Grow(&state, arena);
  std::printf("grow_returned=%s\n", ok ? "true" : "false");
  std::printf("buf_changed=%s\n", before_buf != state.buf ? "true" : "false");
  std::printf("ptr_changed=%s\n", before_ptr != state.ptr ? "true" : "false");
  std::printf("bufsize_after=%zu\n", state.bufsize);
  std::printf("ptr_distance_after=%lld\n",
              static_cast<long long>(state.ptr - state.buf));

  const bool expected_realloc =
      static_cast<size_t>(used64) + kUpb_MtDataEncoder_MinSize > before_size;
  const bool skipped_realloc = ok && before_buf == state.buf &&
                               before_size == state.bufsize &&
                               before_ptr == state.ptr;

  std::printf("expected_realloc=%s\n", expected_realloc ? "true" : "false");
  std::printf("skipped_realloc=%s\n", skipped_realloc ? "true" : "false");

  if (attempt_write && ok) {
    std::fprintf(stderr, "attempting_follow_on_library_write=true\n");
    char* out = upb_MtDataEncoder_StartMessage(&state.e, state.ptr, 0);
    std::printf("write_result=%p\n", static_cast<void*>(out));
  }

  upb_Arena_Free(arena);

  if (!ok) return 3;
  if (expected_realloc && skipped_realloc) return 0;
  return 4;
}

}  // namespace

int main(int argc, char** argv) {
  const bool attempt_write =
      argc > 1 && std::string(argv[1]) == "--attempt-write";
  return Run(attempt_write);
}
