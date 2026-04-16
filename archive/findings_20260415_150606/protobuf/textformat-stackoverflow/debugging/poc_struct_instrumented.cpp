#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>

#define private public
#include <google/protobuf/text_format.h>
#undef private

#include <google/protobuf/struct.pb.h>

#define CHECKPOINT(name) std::fprintf(stderr, "=== %s ===\n", name)
#define STATE_INT(var) std::fprintf(stderr, "[STATE] %s = %d\n", #var, (int)(var))

namespace {

std::string BuildInput(int depth) {
  std::string input;
  input.reserve(static_cast<size_t>(depth) * 48 + 32);
  for (int i = 0; i < depth; ++i) {
    input += "struct_value { fields { key: \"k\" value { ";
  }
  input += "number_value: 1 ";
  for (int i = 0; i < depth; ++i) {
    input += "} } } ";
  }
  return input;
}

int ParsedDepth(const google::protobuf::Value& root) {
  int depth = 0;
  const google::protobuf::Value* current = &root;
  while (current->kind_case() == google::protobuf::Value::kStructValue) {
    const auto& fields = current->struct_value().fields();
    auto it = fields.find("k");
    if (it == fields.end()) {
      break;
    }
    ++depth;
    current = &it->second;
  }
  return depth;
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

  std::string input = BuildInput(target_depth);
  STATE_INT(input.size());

  google::protobuf::Value root;

  CHECKPOINT("before-parse");
  bool ok = parser.ParseFromString(input, &root);
  CHECKPOINT("after-parse");
  STATE_INT(ok);

  int parsed_depth = ParsedDepth(root);
  STATE_INT(parsed_depth);
  return ok ? 0 : 1;
}
