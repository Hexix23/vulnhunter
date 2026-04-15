#include <climits>
#include <cstdint>
#include <iostream>
#include <string>

#define private public
#include "packed_fixed32.pb.h"
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

  std::cerr << "api=google::protobuf::MessageLite::MergeFromString\n";
  std::cerr << "initial_size=" << message.nums_size() << "\n";
  std::cerr << "initial_capacity=" << nums->Capacity() << "\n";
  std::cerr << "payload_bytes=" << payload.size() << "\n";
  std::cerr << "new_entries=1\n";

  const bool ok = message.MergeFromString(payload);
  std::cerr << "merge_ok=" << ok << "\n";
  std::cerr << "final_size=" << message.nums_size() << "\n";
  return ok ? 0 : 1;
}
