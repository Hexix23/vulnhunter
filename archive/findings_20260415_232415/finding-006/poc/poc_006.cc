#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream.h"

namespace {

class ChunkedOutputStream final
    : public google::protobuf::io::ZeroCopyOutputStream {
 public:
  explicit ChunkedOutputStream(std::vector<int> chunk_sizes)
      : chunk_sizes_(std::move(chunk_sizes)) {}

  bool Next(void** data, int* size) override {
    if (next_index_ >= chunk_sizes_.size()) {
      return false;
    }
    const int chunk_size = chunk_sizes_[next_index_++];
    if (chunk_size < 0) {
      return false;
    }
    const size_t start = bytes_produced_;
    storage_.resize(start + static_cast<size_t>(chunk_size));
    *data = storage_.data() + start;
    *size = chunk_size;
    bytes_produced_ += static_cast<size_t>(chunk_size);
    last_returned_size_ = chunk_size;
    return true;
  }

  void BackUp(int count) override {
    if (count < 0 || count > last_returned_size_) {
      std::abort();
    }
    bytes_produced_ -= static_cast<size_t>(count);
    storage_.resize(bytes_produced_);
    last_returned_size_ = 0;
  }

  int64_t ByteCount() const override {
    return static_cast<int64_t>(bytes_produced_);
  }

  bool WriteAliasedRaw(const void*, int) override { return false; }
  bool AllowsAliasing() const override { return false; }

  const std::vector<uint8_t>& data() const { return storage_; }

 private:
  std::vector<int> chunk_sizes_;
  std::vector<uint8_t> storage_;
  size_t bytes_produced_ = 0;
  size_t next_index_ = 0;
  int last_returned_size_ = 0;
};

bool RunCase(int write_size) {
  ChunkedOutputStream sink({16, 16, 32});
  google::protobuf::io::CodedOutputStream out(&sink);

  std::string input(static_cast<size_t>(write_size), '\0');
  for (int i = 0; i < write_size; ++i) {
    input[static_cast<size_t>(i)] = static_cast<char>('A' + (i % 26));
  }

  out.WriteRaw(input.data(), write_size);
  out.Trim();

  if (out.HadError()) {
    std::cerr << "unexpected write error for size=" << write_size << "\n";
    return false;
  }
  if (sink.data().size() != static_cast<size_t>(write_size)) {
    std::cerr << "size mismatch for size=" << write_size << ": got "
              << sink.data().size() << "\n";
    return false;
  }
  if (std::memcmp(sink.data().data(), input.data(),
                  static_cast<size_t>(write_size)) != 0) {
    std::cerr << "content mismatch for size=" << write_size << "\n";
    return false;
  }

  std::cout << "WriteRaw(" << write_size << ") ok\n";
  return true;
}

}  // namespace

int main() {
  constexpr int kSlopBytes =
      google::protobuf::io::EpsCopyOutputStream::kSlopBytes;
  const int sizes[] = {kSlopBytes - 1, kSlopBytes, kSlopBytes + 1};

  for (int size : sizes) {
    if (!RunCase(size)) {
      return 1;
    }
  }

  std::cout
      << "Observed boundary: initial WriteRawFallback GetSize(ptr) is 16, so "
         "size -= s reaches 1 for size 17 and is not zero or negative.\n";
  return 0;
}
