#include <iostream>
#include <string>

#include <google/protobuf/descriptor.pb.h>
#include <google/protobuf/text_format.h>

int main() {
  std::string nested_str;
  nested_str.reserve(5000 * 7 + 5000 * 2);

  for (int i = 0; i < 5000; ++i) {
    nested_str += "file { ";
  }
  for (int i = 0; i < 5000; ++i) {
    nested_str += " }";
  }

  google::protobuf::FileDescriptorSet proto_msg;
  const bool ok =
      google::protobuf::TextFormat::ParseFromString(nested_str, &proto_msg);

  std::cout << "Parse " << (ok ? "succeeded" : "failed") << std::endl;
  return 0;
}
