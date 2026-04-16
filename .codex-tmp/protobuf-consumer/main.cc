#include <google/protobuf/any.pb.h>

int main() {
  google::protobuf::Any any;
  any.set_type_url("type.googleapis.com/test");
  return any.type_url().empty();
}
