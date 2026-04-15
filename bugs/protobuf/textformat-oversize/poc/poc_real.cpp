#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string_view>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "google/protobuf/message.h"
#include "google/protobuf/text_format.h"

namespace {

constexpr size_t kTriggerSize = static_cast<size_t>(INT_MAX) + 1;

int CreateSparseFile(off_t size) {
  char path[] = "/tmp/protobuf-textformat-oversize.XXXXXX";
  int fd = mkstemp(path);
  if (fd < 0) {
    std::perror("mkstemp");
    return -1;
  }
  if (unlink(path) != 0) {
    std::perror("unlink");
    close(fd);
    return -1;
  }
  if (ftruncate(fd, size) != 0) {
    std::perror("ftruncate");
    close(fd);
    return -1;
  }
  return fd;
}

}  // namespace

int main() {
  fprintf(stderr, "Creating sparse %zu-byte mapping\n", kTriggerSize);
  int fd = CreateSparseFile(static_cast<off_t>(kTriggerSize));
  if (fd < 0) return 2;

  void* mapping = mmap(nullptr, kTriggerSize, PROT_READ, MAP_PRIVATE, fd, 0);
  if (mapping == MAP_FAILED) {
    std::perror("mmap");
    close(fd);
    return 3;
  }

  google::protobuf::TextFormat::Parser parser;
  auto* sentinel =
      reinterpret_cast<google::protobuf::Message*>(static_cast<uintptr_t>(1));

  fprintf(stderr,
          "Invoking ParseFromString with default null error collector and "
          "sentinel Message*\n");
  bool ok = parser.ParseFromString(
      std::string_view(static_cast<const char*>(mapping), kTriggerSize),
      sentinel);

  fprintf(stderr, "ParseFromString returned %s\n", ok ? "true" : "false");
  munmap(mapping, kTriggerSize);
  close(fd);
  return ok ? 0 : 1;
}
