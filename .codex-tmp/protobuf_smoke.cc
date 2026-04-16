#include <google/protobuf/any.pb.h>
#include <string>
int main() {
  google::protobuf::Any msg;
  msg.set_type_url("type.googleapis.com/example.Test");
  msg.set_value("abc");
  std::string out;
  return msg.SerializeToString(&out) ? 0 : 1;
}
