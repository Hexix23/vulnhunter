#include <google/protobuf/descriptor.h>
int main() {
  const auto* pool = google::protobuf::DescriptorPool::generated_pool();
  return pool ? 0 : 1;
}
