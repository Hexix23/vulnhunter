#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "absl/strings/str_cat.h"
#include "google/protobuf/compiler/parser.h"
#include "google/protobuf/descriptor.pb.h"
#include "google/protobuf/io/tokenizer.h"
#include "google/protobuf/io/zero_copy_stream.h"

namespace {

class FailingInputStream final : public google::protobuf::io::ZeroCopyInputStream {
 public:
  explicit FailingInputStream(std::vector<std::string> chunks)
      : chunks_(std::move(chunks)) {}

  bool Next(const void** data, int* size) override {
    if (index_ < static_cast<int>(chunks_.size())) {
      current_ = chunks_[index_++];
      *data = current_.data();
      *size = static_cast<int>(current_.size());
      byte_count_ += *size;
      return true;
    }
    *data = nullptr;
    *size = 0;
    failed_ = true;
    return false;
  }

  void BackUp(int count) override {
    if (count > 0) byte_count_ -= count;
  }

  bool Skip(int count) override {
    byte_count_ += count;
    failed_ = true;
    return false;
  }

  int64_t ByteCount() const override { return byte_count_; }

  bool failed() const { return failed_; }
  int calls() const { return index_ + (failed_ ? 1 : 0); }

 private:
  std::vector<std::string> chunks_;
  std::string current_;
  int index_ = 0;
  int64_t byte_count_ = 0;
  bool failed_ = false;
};

class CollectingErrorCollector final : public google::protobuf::io::ErrorCollector {
 public:
  void RecordError(int line, int column, absl::string_view message) override {
    errors_.push_back(absl::StrCat(line, ":", column, ": ", message));
  }

  void RecordWarning(int line, int column, absl::string_view message) override {
    warnings_.push_back(absl::StrCat(line, ":", column, ": ", message));
  }

  const std::vector<std::string>& errors() const { return errors_; }
  const std::vector<std::string>& warnings() const { return warnings_; }

 private:
  std::vector<std::string> errors_;
  std::vector<std::string> warnings_;
};

void PrintMessages(const char* label, const std::vector<std::string>& messages) {
  std::printf("%s_count=%zu\n", label, messages.size());
  for (const auto& message : messages) {
    std::printf("%s: %s\n", label, message.c_str());
  }
}

}  // namespace

int main() {
  FailingInputStream tokenizer_stream({});
  CollectingErrorCollector tokenizer_collector;
  google::protobuf::io::Tokenizer tokenizer_probe(&tokenizer_stream,
                                                  &tokenizer_collector);
  const bool tokenizer_next = tokenizer_probe.Next();

  std::printf("tokenizer_next=%d\n", tokenizer_next ? 1 : 0);
  std::printf("tokenizer_stream_failed=%d\n", tokenizer_stream.failed() ? 1 : 0);
  PrintMessages("tokenizer_error", tokenizer_collector.errors());

  FailingInputStream parser_stream({});
  CollectingErrorCollector parser_collector;
  google::protobuf::io::Tokenizer tokenizer(&parser_stream, &parser_collector);
  google::protobuf::compiler::Parser parser;
  parser.RecordErrorsTo(&parser_collector);

  google::protobuf::FileDescriptorProto file;
  file.set_name("failing.proto");

  const bool ok = parser.Parse(&tokenizer, &file);

  std::printf("parser_ok=%d\n", ok ? 1 : 0);
  std::printf("parser_stream_failed=%d\n", parser_stream.failed() ? 1 : 0);
  std::printf("next_calls=%d\n", parser_stream.calls());
  std::printf("message_type_count=%d\n", file.message_type_size());
  std::printf("syntax='%s'\n", file.syntax().c_str());
  PrintMessages("error", parser_collector.errors());
  PrintMessages("warning", parser_collector.warnings());

  if (!tokenizer_next && tokenizer_stream.failed() &&
      tokenizer_collector.errors().empty() && ok && parser_stream.failed() &&
      parser_collector.errors().empty()) {
    std::printf("RESULT=LOGIC_BUG\n");
    return 0;
  }

  std::printf("RESULT=NO_BUG\n");
  return 1;
}
