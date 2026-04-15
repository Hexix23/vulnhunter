#include <iostream>
#include <string>

#include "google/protobuf/io/tokenizer.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"

int main() {
  // This revalidation harness only exercises code that is present in the
  // prebuilt library. The originally reported C upb tokenizer path is not
  // exported by the shipped archive in this workspace.
  const std::string token_text = "\"line1\\nline2\\u0041\\123\"";

  std::string parsed;
  google::protobuf::io::Tokenizer::ParseStringAppend(token_text, &parsed);

  google::protobuf::io::ArrayInputStream input(token_text.data(),
                                               static_cast<int>(token_text.size()),
                                               3);
  google::protobuf::io::Tokenizer tokenizer(&input, nullptr);

  if (!tokenizer.Next()) {
    std::cerr << "Tokenizer failed to read the test token" << std::endl;
    return 2;
  }
  const google::protobuf::io::Tokenizer::Token& token = tokenizer.current();

  std::cout << "token.type=" << token.type << "\n";
  std::cout << "token.text=" << token.text << "\n";
  std::cout << "parsed.size=" << parsed.size() << "\n";
  std::cout << "parsed.bytes=";
  for (unsigned char c : parsed) {
    std::cout << static_cast<unsigned int>(c) << ' ';
  }
  std::cout << "\n";

  return 0;
}
