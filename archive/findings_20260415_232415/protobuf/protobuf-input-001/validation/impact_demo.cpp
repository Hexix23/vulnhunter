#include <fcntl.h>
#include <mach/mach.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <unistd.h>

#include <cerrno>
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "upb/mem/arena.h"

namespace {

bool CheckedRead(int fd, void* buf, size_t len) {
  size_t ofs = 0;
  while (len > 0) {
    ssize_t bytes_read = read(fd, static_cast<char*>(buf) + ofs, len);
    if (bytes_read == 0) return false;
    if (bytes_read < 0) {
      std::perror("read");
      return false;
    }
    len -= static_cast<size_t>(bytes_read);
    ofs += static_cast<size_t>(bytes_read);
  }
  return true;
}

uint64_t ResidentBytes() {
  mach_task_basic_info info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  kern_return_t kr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                               reinterpret_cast<task_info_t>(&info), &count);
  if (kr != KERN_SUCCESS) return 0;
  return info.resident_size;
}

int CreateSparsePayloadFile(uint32_t payload_size) {
  char path[] = "/tmp/protobuf-impact-XXXXXX";
  int fd = mkstemp(path);
  if (fd < 0) {
    std::perror("mkstemp");
    return -1;
  }

  unlink(path);

  uint32_t little = payload_size;
  if (write(fd, &little, sizeof(little)) != sizeof(little)) {
    std::perror("write");
    close(fd);
    return -1;
  }

  off_t total = static_cast<off_t>(sizeof(little)) + payload_size;
  if (ftruncate(fd, total) != 0) {
    std::perror("ftruncate");
    close(fd);
    return -1;
  }

  if (lseek(fd, 0, SEEK_SET) < 0) {
    std::perror("lseek");
    close(fd);
    return -1;
  }

  return fd;
}

int CreatePrefixOnlyFile(uint32_t payload_size) {
  char path[] = "/tmp/protobuf-impact-prefix-XXXXXX";
  int fd = mkstemp(path);
  if (fd < 0) {
    std::perror("mkstemp");
    return -1;
  }

  unlink(path);

  uint32_t little = payload_size;
  if (write(fd, &little, sizeof(little)) != sizeof(little)) {
    std::perror("write");
    close(fd);
    return -1;
  }

  if (lseek(fd, 0, SEEK_SET) < 0) {
    std::perror("lseek");
    close(fd);
    return -1;
  }

  return fd;
}

int RunBoundaryRead(int fd) {
  uint32_t input_size = 0;
  if (!CheckedRead(fd, &input_size, sizeof(input_size))) {
    std::fprintf(stderr, "failed to read input size\n");
    return 1;
  }

  upb_Arena* arena = upb_Arena_New();
  if (!arena) {
    std::fprintf(stderr, "failed to create arena\n");
    return 1;
  }

  size_t fused_count_before = 0;
  uint64_t rss_before = ResidentBytes();
  uintptr_t arena_before = upb_Arena_SpaceAllocated(arena, &fused_count_before);

  char* input = static_cast<char*>(upb_Arena_Malloc(arena, input_size));
  if (!input) {
    std::fprintf(stderr, "upb_Arena_Malloc returned NULL for %" PRIu32 "\n",
                 input_size);
    upb_Arena_Free(arena);
    return 2;
  }

  size_t fused_count_after_alloc = 0;
  uintptr_t arena_after_alloc =
      upb_Arena_SpaceAllocated(arena, &fused_count_after_alloc);
  uint64_t rss_after_alloc = ResidentBytes();

  if (!CheckedRead(fd, input, input_size)) {
    std::fprintf(stderr,
                 "payload read failed for %" PRIu32
                 " bytes after allocation: arena_growth=%" PRIuPTR
                 " rss_growth=%" PRIu64 " fused=%zu\n",
                 input_size, arena_after_alloc - arena_before,
                 rss_after_alloc - rss_before, fused_count_after_alloc);
    upb_Arena_Free(arena);
    return 3;
  }

  size_t fused_count_after = 0;
  uintptr_t arena_after = upb_Arena_SpaceAllocated(arena, &fused_count_after);
  uint64_t rss_after = ResidentBytes();

  std::printf("input_size=%" PRIu32 "\n", input_size);
  std::printf("arena_before=%" PRIuPTR "\n", arena_before);
  std::printf("arena_after=%" PRIuPTR "\n", arena_after);
  std::printf("arena_growth=%" PRIuPTR "\n", arena_after - arena_before);
  std::printf("rss_before=%" PRIu64 "\n", rss_before);
  std::printf("rss_after=%" PRIu64 "\n", rss_after);
  std::printf("rss_growth=%" PRIu64 "\n", rss_after - rss_before);
  std::printf("buffer_first=%u\n", static_cast<unsigned>(input[0]));
  std::printf("buffer_last=%u\n",
              static_cast<unsigned>(input[input_size - 1]));

  upb_Arena_Free(arena);
  close(fd);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  uint32_t payload_size = 256u * 1024u * 1024u;
  bool prefix_only = false;

  if (argc > 1 && std::strcmp(argv[1], "--prefix-only") == 0) {
    prefix_only = true;
    --argc;
    ++argv;
  }

  if (argc > 1) {
    char* end = nullptr;
    unsigned long long parsed = std::strtoull(argv[1], &end, 10);
    if (!end || *end != '\0' || parsed == 0 || parsed > UINT32_MAX) {
      std::fprintf(stderr, "invalid payload size: %s\n", argv[1]);
      return 1;
    }
    payload_size = static_cast<uint32_t>(parsed);
  }

  int fd = prefix_only ? CreatePrefixOnlyFile(payload_size)
                       : CreateSparsePayloadFile(payload_size);
  if (fd < 0) return 1;
  return RunBoundaryRead(fd);
}
