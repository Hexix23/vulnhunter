#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string_view>

#include "google/protobuf/any.pb.h"
#include "google/protobuf/text_format.h"

namespace {

void Die(const char* what) {
  std::perror(what);
  std::exit(2);
}

}  // namespace

int main() {
  constexpr size_t kSize = static_cast<size_t>(INT_MAX) + 1;
  char path[] = "/tmp/protobuf-oversize.XXXXXX";
  int fd = mkstemp(path);
  if (fd < 0) Die("mkstemp");

  unlink(path);

  if (ftruncate(fd, static_cast<off_t>(kSize)) != 0) Die("ftruncate");

  void* mapped = mmap(nullptr, kSize, PROT_READ, MAP_PRIVATE, fd, 0);
  if (mapped == MAP_FAILED) Die("mmap");

  google::protobuf::Any message;
  google::protobuf::TextFormat::Parser parser;
  bool ok = parser.ParseFromString(
      std::string_view(static_cast<const char*>(mapped), kSize), &message);

  munmap(mapped, kSize);
  close(fd);

  return ok ? 0 : 1;
}
