#include <cstdlib>
#include <iostream>
#include <string>

#include <google/protobuf/text_format.h>
#include <google/protobuf/unknown_field_set.h>

int main(int argc, char** argv) {
  int depth = 50000;
  if (argc > 1) {
    depth = std::atoi(argv[1]);
    if (depth < 0) {
      std::cerr << "Depth must be non-negative\n";
      return 1;
    }
  }

  google::protobuf::UnknownFieldSet root;
  google::protobuf::UnknownFieldSet* current = &root;
  for (int i = 0; i < depth; ++i) {
    current = current->AddGroup(1);
  }

  std::string output;
  if (!google::protobuf::TextFormat::PrintUnknownFieldsToString(root, &output)) {
    std::cerr << "PrintUnknownFieldsToString failed\n";
    return 1;
  }

  std::cout << "Depth: " << depth << "\n";
  std::cout << "Output size: " << output.size() << "\n";
  return 0;
}
