#include <cstdlib>
#include <iostream>
#include <string>

#include "google/protobuf/text_format.h"
#include "google/protobuf/unknown_field_set.h"

namespace {

constexpr int kObservedUnknownFieldRecursionLimit = 10;

int GetDepth(int argc, char** argv) {
  if (argc > 1) {
    return std::atoi(argv[1]);
  }
  return 12;
}

int CountChar(const std::string& text, char needle) {
  int count = 0;
  for (char c : text) {
    if (c == needle) {
      ++count;
    }
  }
  return count;
}

int CountSubstring(const std::string& text, const std::string& needle) {
  if (needle.empty()) {
    return 0;
  }

  int count = 0;
  std::string::size_type pos = 0;
  while ((pos = text.find(needle, pos)) != std::string::npos) {
    ++count;
    pos += needle.size();
  }
  return count;
}

}  // namespace

int main(int argc, char** argv) {
  const int depth = GetDepth(argc, argv);
  if (depth <= 0) {
    std::cerr << "depth must be positive\n";
    return 2;
  }

  google::protobuf::UnknownFieldSet unknown_fields;
  google::protobuf::UnknownFieldSet* cursor = &unknown_fields;
  for (int i = 0; i < depth; ++i) {
    cursor = cursor->AddGroup(1);
  }
  cursor->AddVarint(2, 0x42);

  google::protobuf::TextFormat::Printer printer;
  printer.SetSingleLineMode(true);

  std::string output;
  const bool ok = printer.PrintUnknownFieldsToString(unknown_fields, &output);

  const int open_braces = CountChar(output, '{');
  const int close_braces = CountChar(output, '}');
  const int group_occurrences = CountSubstring(output, "1 {");
  const bool terminal_value_present = output.find("2: 66") != std::string::npos;
  const int expected_budget_after_last_group =
      kObservedUnknownFieldRecursionLimit - depth;

  std::cout << "configured_unknown_field_recursion_limit="
            << kObservedUnknownFieldRecursionLimit << "\n";
  std::cout << "constructed_group_depth=" << depth << "\n";
  std::cout << "expected_budget_after_last_group="
            << expected_budget_after_last_group << "\n";
  std::cout << "print_ok=" << (ok ? 1 : 0) << "\n";
  std::cout << "output_size=" << output.size() << "\n";
  std::cout << "output_open_braces=" << open_braces << "\n";
  std::cout << "output_close_braces=" << close_braces << "\n";
  std::cout << "output_group_occurrences=" << group_occurrences << "\n";
  std::cout << "terminal_value_present=" << (terminal_value_present ? 1 : 0)
            << "\n";
  std::cout << "output=" << output << "\n";

  if (depth > kObservedUnknownFieldRecursionLimit && terminal_value_present &&
      group_occurrences == depth) {
    std::cout << "state_bug=1\n";
    return 0;
  }

  std::cout << "state_bug=0\n";
  return 1;
}
