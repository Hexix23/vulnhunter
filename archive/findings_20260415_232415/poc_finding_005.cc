#include <cstdint>
#include <iomanip>
#include <iostream>
#include <vector>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/io/zero_copy_stream.h"

namespace pbio = google::protobuf::io;

namespace {

std::vector<uint8_t> EncodeVarint(uint64_t value) {
  std::vector<uint8_t> out;
  do {
    uint8_t byte = static_cast<uint8_t>(value & 0x7fU);
    value >>= 7;
    if (value != 0) byte |= 0x80U;
    out.push_back(byte);
  } while (value != 0);
  return out;
}

class TwoChunkInputStream final : public pbio::ZeroCopyInputStream {
 public:
  explicit TwoChunkInputStream(std::vector<uint8_t> second_chunk)
      : second_chunk_(std::move(second_chunk)) {}

  bool Next(const void** data, int* size) override {
    if (chunk_index_ == 0) {
      *data = &dummy_;
      *size = 1;
      last_returned_size_ = 1;
      ++chunk_index_;
      byte_count_ += 1;
      return true;
    }
    if (chunk_index_ == 1) {
      *data = second_chunk_.data();
      *size = static_cast<int>(second_chunk_.size());
      last_returned_size_ = *size;
      ++chunk_index_;
      byte_count_ += *size;
      return true;
    }
    *data = nullptr;
    *size = 0;
    last_returned_size_ = 0;
    return false;
  }

  void BackUp(int count) override {
    if (count < 0 || count > last_returned_size_) return;
    byte_count_ -= count;
    last_returned_size_ -= count;
  }

  bool Skip(int count) override {
    if (count < 0) return false;
    const void* data = nullptr;
    int size = 0;
    while (count > 0) {
      if (!Next(&data, &size)) return false;
      if (size > count) {
        BackUp(size - count);
        return true;
      }
      count -= size;
    }
    return true;
  }

  int64_t ByteCount() const override { return byte_count_; }

 private:
  uint8_t dummy_ = 0x08;
  std::vector<uint8_t> second_chunk_;
  int chunk_index_ = 0;
  int last_returned_size_ = 0;
  int64_t byte_count_ = 0;
};

}  // namespace

int main() {
  const uint64_t oversized_tag = 0x100000001ULL;
  const std::vector<uint8_t> encoded = EncodeVarint(oversized_tag);

  std::cout << "original_encoded_value_dec=" << oversized_tag << "\n";
  std::cout << "original_encoded_value_hex=0x" << std::hex << oversized_tag
            << std::dec << "\n";
  std::cout << "encoded_varint_bytes=";
  for (size_t i = 0; i < encoded.size(); ++i) {
    if (i != 0) std::cout << ' ';
    std::cout << "0x" << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<unsigned>(encoded[i]) << std::dec;
  }
  std::cout << "\n";

  TwoChunkInputStream stream(encoded);
  pbio::CodedInputStream input(&stream);

  if (!input.Skip(1)) {
    std::cerr << "failed_to_consume_dummy_chunk\n";
    return 1;
  }

  const uint32_t returned_tag = input.ReadTag();
  std::cout << "returned_tag_dec=" << returned_tag << "\n";
  std::cout << "returned_tag_hex=0x" << std::hex << returned_tag << std::dec
            << "\n";
  std::cout << "truncation_observed="
            << (static_cast<uint64_t>(returned_tag) != oversized_tag ? "true"
                                                                     : "false")
            << "\n";

  return 0;
}
