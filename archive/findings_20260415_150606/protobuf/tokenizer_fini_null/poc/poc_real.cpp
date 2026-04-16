#include <iostream>

#include "google/protobuf/io/tokenizer.h"

int main() {
  using google::protobuf::io::Tokenizer;
  using google::protobuf::io::ZeroCopyInputStream;

  std::cerr << "Constructing Tokenizer with null ZeroCopyInputStream..."
            << std::endl;

  ZeroCopyInputStream* input = nullptr;
  Tokenizer tokenizer(input, nullptr);

  std::cerr << "Unexpectedly survived construction. Current token type: "
            << tokenizer.current().type << std::endl;
  return 0;
}
