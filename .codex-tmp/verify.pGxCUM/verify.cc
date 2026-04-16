#include <google/protobuf/arena.h>
#include <google/protobuf/message_lite.h>
int main() {
  google::protobuf::Arena arena;
  (void)arena.SpaceAllocated();
  return 0;
}
