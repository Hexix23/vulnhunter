#define private public
#include "google/protobuf/compiler/parser.h"
#include "google/protobuf/io/tokenizer.h"
#undef private

#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>

#include "absl/strings/str_cat.h"
#include "google/protobuf/descriptor.pb.h"
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

void PrintCollector(const char* prefix, const CollectingErrorCollector& collector) {
  std::printf("%s_errors=%zu\n", prefix, collector.errors().size());
  for (const auto& error : collector.errors()) {
    std::printf("%s_error=%s\n", prefix, error.c_str());
  }
  std::printf("%s_warnings=%zu\n", prefix, collector.warnings().size());
}

}  // namespace

int main() {
  FailingInputStream tokenizer_stream({});
  CollectingErrorCollector tokenizer_collector;
  google::protobuf::io::Tokenizer tokenizer_probe(&tokenizer_stream,
                                                  &tokenizer_collector);

  std::printf("[TOKENIZER_CTOR] stream_failed=%d calls=%d read_error=%d buffer_size=%d current_type=%d current_char=0x%02x collector_errors=%zu\n",
              tokenizer_stream.failed() ? 1 : 0, tokenizer_stream.calls(),
              tokenizer_probe.read_error_ ? 1 : 0, tokenizer_probe.buffer_size_,
              static_cast<int>(tokenizer_probe.current_.type),
              static_cast<unsigned char>(tokenizer_probe.current_char_),
              tokenizer_collector.errors().size());

  const bool tokenizer_next = tokenizer_probe.Next();
  std::printf("[TOKENIZER_NEXT] next=%d stream_failed=%d calls=%d read_error=%d current_type=%d previous_type=%d current_char=0x%02x collector_errors=%zu\n",
              tokenizer_next ? 1 : 0, tokenizer_stream.failed() ? 1 : 0,
              tokenizer_stream.calls(), tokenizer_probe.read_error_ ? 1 : 0,
              static_cast<int>(tokenizer_probe.current_.type),
              static_cast<int>(tokenizer_probe.previous_.type),
              static_cast<unsigned char>(tokenizer_probe.current_char_),
              tokenizer_collector.errors().size());
  PrintCollector("tokenizer", tokenizer_collector);

  FailingInputStream parser_stream({});
  CollectingErrorCollector parser_collector;
  google::protobuf::io::Tokenizer tokenizer(&parser_stream, &parser_collector);
  google::protobuf::compiler::Parser parser;
  parser.RecordErrorsTo(&parser_collector);
  google::protobuf::FileDescriptorProto file;
  file.set_name("failing.proto");

  std::printf("[PARSER_BEFORE] stream_failed=%d calls=%d tokenizer_read_error=%d tokenizer_current_type=%d parser_had_errors=%d syntax='%s' parser_errors=%zu\n",
              parser_stream.failed() ? 1 : 0, parser_stream.calls(),
              tokenizer.read_error_ ? 1 : 0,
              static_cast<int>(tokenizer.current_.type),
              parser.had_errors_ ? 1 : 0, parser.syntax_identifier_.c_str(),
              parser_collector.errors().size());

  const bool ok = parser.Parse(&tokenizer, &file);

  std::printf("[PARSER_AFTER] ok=%d stream_failed=%d calls=%d tokenizer_read_error=%d tokenizer_current_type=%d parser_had_errors=%d syntax='%s' message_types=%d parser_errors=%zu\n",
              ok ? 1 : 0, parser_stream.failed() ? 1 : 0, parser_stream.calls(),
              tokenizer.read_error_ ? 1 : 0,
              static_cast<int>(tokenizer.current_.type),
              parser.had_errors_ ? 1 : 0, parser.syntax_identifier_.c_str(),
              file.message_type_size(), parser_collector.errors().size());
  std::printf("[FILE_STATE] file_name='%s' file_syntax='%s'\n",
              file.name().c_str(), file.syntax().c_str());
  PrintCollector("parser", parser_collector);

  return 0;
}
