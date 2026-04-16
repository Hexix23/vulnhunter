#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>
#include <vector>

#include <sys/resource.h>

#include "google/protobuf/descriptor.upb.h"
#include "upb/base/status.h"
#include "upb/base/string_view.h"
#include "upb/mem/arena.h"
#include "upb/reflection/def_pool.h"
#include "upb/reflection/enum_def.h"
#include "upb/reflection/message_def.h"

namespace {

constexpr int kFieldLabelOptional = 1;
constexpr int kFieldTypeInt32 = 5;

struct SampleResult {
  bool ok;
  std::string kind;
  int count;
  size_t serialized_size;
  size_t mini_descriptor_size;
  long max_rss_kb;
  std::string failure;
};

long ReadMaxRssKb() {
  struct rusage usage;
  if (getrusage(RUSAGE_SELF, &usage) != 0) return -1;
  return usage.ru_maxrss;
}

std::string MakeFieldName(int i) {
  return "field_" + std::to_string(i);
}

std::string MakeEnumValueName(int i) {
  return "VALUE_" + std::to_string(i);
}

SampleResult BuildFieldSample(int field_count) {
  SampleResult result = {false, "message_fields", field_count, 0, 0,
                         ReadMaxRssKb(), ""};

  upb_Arena* arena = upb_Arena_New();
  upb_Arena* encode_arena = upb_Arena_New();
  upb_DefPool* pool = upb_DefPool_New();
  if (!arena || !encode_arena || !pool) {
    result.failure = "failed to allocate arena or def pool";
    if (pool) upb_DefPool_Free(pool);
    if (encode_arena) upb_Arena_Free(encode_arena);
    if (arena) upb_Arena_Free(arena);
    return result;
  }

  google_protobuf_FileDescriptorProto* file =
      google_protobuf_FileDescriptorProto_new(arena);
  google_protobuf_FileDescriptorProto_set_name(
      file, upb_StringView_FromString("impact_fields.proto"));

  google_protobuf_DescriptorProto* msg =
      google_protobuf_FileDescriptorProto_add_message_type(file, arena);
  google_protobuf_DescriptorProto_set_name(msg,
                                           upb_StringView_FromString("BigMsg"));

  std::vector<std::string> field_names;
  field_names.reserve(field_count);

  for (int i = 1; i <= field_count; ++i) {
    google_protobuf_FieldDescriptorProto* field =
        google_protobuf_DescriptorProto_add_field(msg, arena);
    field_names.push_back(MakeFieldName(i));
    google_protobuf_FieldDescriptorProto_set_name(
        field, upb_StringView_FromString(field_names.back().c_str()));
    google_protobuf_FieldDescriptorProto_set_number(field, i);
    google_protobuf_FieldDescriptorProto_set_label(field,
                                                   kFieldLabelOptional);
    google_protobuf_FieldDescriptorProto_set_type(field, kFieldTypeInt32);
  }

  size_t serialized_size = 0;
  if (!google_protobuf_FileDescriptorProto_serialize(file, arena,
                                                     &serialized_size)) {
    result.failure = "failed to serialize field descriptor input";
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  upb_Status status;
  upb_Status_Clear(&status);
  const upb_FileDef* added = upb_DefPool_AddFile(pool, file, &status);
  if (!added) {
    result.failure = upb_Status_ErrorMessage(&status);
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  (void)added;
  const upb_MessageDef* msgdef = upb_DefPool_FindMessageByName(pool, "BigMsg");
  if (!msgdef) {
    result.failure = "upb_DefPool_FindMessageByName(BigMsg) failed";
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  upb_StringView mini_desc;
  if (!upb_MessageDef_MiniDescriptorEncode(msgdef, encode_arena, &mini_desc)) {
    result.failure = "upb_MessageDef_MiniDescriptorEncode failed";
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  result.ok = true;
  result.serialized_size = serialized_size;
  result.mini_descriptor_size = mini_desc.size;
  result.max_rss_kb = ReadMaxRssKb();

  upb_DefPool_Free(pool);
  upb_Arena_Free(encode_arena);
  upb_Arena_Free(arena);
  return result;
}

SampleResult BuildEnumSample(int value_count) {
  SampleResult result = {false, "enum_values", value_count, 0, 0,
                         ReadMaxRssKb(), ""};

  upb_Arena* arena = upb_Arena_New();
  upb_Arena* encode_arena = upb_Arena_New();
  upb_DefPool* pool = upb_DefPool_New();
  if (!arena || !encode_arena || !pool) {
    result.failure = "failed to allocate arena or def pool";
    if (pool) upb_DefPool_Free(pool);
    if (encode_arena) upb_Arena_Free(encode_arena);
    if (arena) upb_Arena_Free(arena);
    return result;
  }

  google_protobuf_FileDescriptorProto* file =
      google_protobuf_FileDescriptorProto_new(arena);
  google_protobuf_FileDescriptorProto_set_name(
      file, upb_StringView_FromString("impact_enum.proto"));

  google_protobuf_EnumDescriptorProto* enum_proto =
      google_protobuf_FileDescriptorProto_add_enum_type(file, arena);
  google_protobuf_EnumDescriptorProto_set_name(
      enum_proto, upb_StringView_FromString("BigEnum"));

  std::vector<std::string> value_names;
  value_names.reserve(value_count);

  for (int i = 0; i < value_count; ++i) {
    google_protobuf_EnumValueDescriptorProto* value =
        google_protobuf_EnumDescriptorProto_add_value(enum_proto, arena);
    value_names.push_back(MakeEnumValueName(i));
    google_protobuf_EnumValueDescriptorProto_set_name(
        value, upb_StringView_FromString(value_names.back().c_str()));
    google_protobuf_EnumValueDescriptorProto_set_number(value, i);
  }

  size_t serialized_size = 0;
  if (!google_protobuf_FileDescriptorProto_serialize(file, arena,
                                                     &serialized_size)) {
    result.failure = "failed to serialize enum descriptor input";
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  upb_Status status;
  upb_Status_Clear(&status);
  const upb_FileDef* added = upb_DefPool_AddFile(pool, file, &status);
  if (!added) {
    result.failure = upb_Status_ErrorMessage(&status);
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  (void)added;
  const upb_EnumDef* enum_def = upb_DefPool_FindEnumByName(pool, "BigEnum");
  if (!enum_def) {
    result.failure = "upb_DefPool_FindEnumByName(BigEnum) failed";
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  upb_StringView mini_desc;
  if (!upb_EnumDef_MiniDescriptorEncode(enum_def, encode_arena, &mini_desc)) {
    result.failure = "upb_EnumDef_MiniDescriptorEncode failed";
    upb_DefPool_Free(pool);
    upb_Arena_Free(encode_arena);
    upb_Arena_Free(arena);
    return result;
  }

  result.ok = true;
  result.serialized_size = serialized_size;
  result.mini_descriptor_size = mini_desc.size;
  result.max_rss_kb = ReadMaxRssKb();

  upb_DefPool_Free(pool);
  upb_Arena_Free(encode_arena);
  upb_Arena_Free(arena);
  return result;
}

double PerItemGrowth(const SampleResult& baseline, const SampleResult& sample) {
  if (sample.count <= baseline.count) return 0.0;
  if (sample.mini_descriptor_size <= baseline.mini_descriptor_size) return 0.0;
  return static_cast<double>(sample.mini_descriptor_size -
                             baseline.mini_descriptor_size) /
         static_cast<double>(sample.count - baseline.count);
}

double ProjectedCountForIntMax(const SampleResult& baseline,
                               const SampleResult& sample) {
  const double per_item = PerItemGrowth(baseline, sample);
  if (per_item <= 0.0) return 0.0;
  const double target =
      static_cast<double>(std::numeric_limits<int>::max()) + 1.0;
  if (baseline.mini_descriptor_size >= target) return baseline.count;
  return baseline.count +
         std::ceil((target - baseline.mini_descriptor_size) / per_item);
}

double ProjectedInputBytes(const SampleResult& baseline,
                           const SampleResult& sample) {
  const double projected_count = ProjectedCountForIntMax(baseline, sample);
  if (projected_count <= 0.0 || sample.count == 0) return 0.0;
  const double serialized_per_item =
      static_cast<double>(sample.serialized_size) / sample.count;
  return serialized_per_item * projected_count;
}

void PrintSample(const SampleResult& result) {
  if (!result.ok) {
    std::printf("kind=%s count=%d status=error detail=%s\n", result.kind.c_str(),
                result.count, result.failure.c_str());
    return;
  }

  std::printf(
      "kind=%s count=%d status=ok serialized_bytes=%zu mini_descriptor_bytes=%zu "
      "max_rss_kb=%ld\n",
      result.kind.c_str(), result.count, result.serialized_size,
      result.mini_descriptor_size, result.max_rss_kb);
}

void PrintProjection(const SampleResult& baseline, const SampleResult& sample) {
  const double per_item = PerItemGrowth(baseline, sample);
  const double projected_count = ProjectedCountForIntMax(baseline, sample);
  const double projected_input = ProjectedInputBytes(baseline, sample);

  std::printf(
      "projection kind=%s avg_mini_desc_growth_per_item=%.6f "
      "projected_items_for_INT_MAX=%.0f projected_input_bytes=%.0f "
      "projected_input_gib=%.2f\n",
      sample.kind.c_str(), per_item, projected_count, projected_input,
      projected_input / (1024.0 * 1024.0 * 1024.0));
}

}  // namespace

int main(int argc, char** argv) {
  const int sample_count = argc > 1 ? std::atoi(argv[1]) : 100000;
  if (sample_count < 2) {
    std::fprintf(stderr, "sample_count must be >= 2\n");
    return 2;
  }

  const SampleResult field_baseline = BuildFieldSample(1);
  const SampleResult field_sample = BuildFieldSample(sample_count);
  const SampleResult enum_baseline = BuildEnumSample(1);
  const SampleResult enum_sample = BuildEnumSample(sample_count);

  PrintSample(field_baseline);
  PrintSample(field_sample);
  PrintProjection(field_baseline, field_sample);
  PrintSample(enum_baseline);
  PrintSample(enum_sample);
  PrintProjection(enum_baseline, enum_sample);

  if (!field_baseline.ok || !field_sample.ok || !enum_baseline.ok ||
      !enum_sample.ok) {
    return 1;
  }

  return 0;
}
