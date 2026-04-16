#include "absl/strings/cord.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

int main() {
  absl::Cord cord("abcdef");
  google::protobuf::io::CordInputStream in(&cord);
  bool ok = in.Skip(-1);  // negative skip!
  return 0;
}
