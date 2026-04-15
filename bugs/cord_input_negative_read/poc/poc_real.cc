#include "absl/strings/cord.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

int main() {
  absl::Cord src("abcdef");
  absl::Cord dst;
  google::protobuf::io::CordInputStream in(&src);
  bool ok = in.ReadCord(&dst, -1);  // negative size!
  return 0;
}
