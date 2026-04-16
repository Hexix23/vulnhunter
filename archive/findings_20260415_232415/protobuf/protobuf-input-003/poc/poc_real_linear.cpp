#include <climits>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <string>

#include "google/protobuf/descriptor.pb.h"
#include "google/protobuf/descriptor.upb.h"
#include "upb/base/status.h"
#include "upb/mem/arena.h"
#include "upb/message/array.h"
#include "upb/message/message.h"
#include "upb/message/value.h"
#include "upb/reflection/def_pool.h"
#include "upb/reflection/field_def.h"
#include "upb/reflection/message.h"
#include "upb/reflection/message_def.h"
#include "upb/util/required_fields.h"

namespace {

google_protobuf_FileDescriptorProto* ToUpbDescriptor(
    const google::protobuf::FileDescriptorProto& proto, upb_Arena* arena) {
  std::string serialized;
  if (!proto.SerializeToString(&serialized)) return nullptr;
  return google_protobuf_FileDescriptorProto_parse(serialized.data(),
                                                   serialized.size(), arena);
}

const upb_MessageDef* BuildLinearDef(upb_DefPool* defpool, upb_Arena* arena,
                                     upb_Status* status) {
  google::protobuf::FileDescriptorProto file;
  file.set_name("asan_validator_required_fields_linear.proto");
  file.set_package("asan_validator");
  file.set_syntax("proto2");

  auto* missing = file.add_message_type();
  missing->set_name("Missing");
  auto* req = missing->add_field();
  req->set_name("req");
  req->set_number(1);
  req->set_label(google::protobuf::FieldDescriptorProto::LABEL_REQUIRED);
  req->set_type(google::protobuf::FieldDescriptorProto::TYPE_INT32);

  auto* root = file.add_message_type();
  root->set_name("Root");

  auto* required_message = root->add_field();
  required_message->set_name("required_message");
  required_message->set_number(1);
  required_message->set_label(
      google::protobuf::FieldDescriptorProto::LABEL_REQUIRED);
  required_message->set_type(google::protobuf::FieldDescriptorProto::TYPE_MESSAGE);
  required_message->set_type_name(".asan_validator.Missing");

  auto* repeated_message = root->add_field();
  repeated_message->set_name("repeated_message");
  repeated_message->set_number(2);
  repeated_message->set_label(
      google::protobuf::FieldDescriptorProto::LABEL_REPEATED);
  repeated_message->set_type(google::protobuf::FieldDescriptorProto::TYPE_MESSAGE);
  repeated_message->set_type_name(".asan_validator.Missing");

  google_protobuf_FileDescriptorProto* upb_file = ToUpbDescriptor(file, arena);
  if (!upb_file) return nullptr;
  if (!upb_DefPool_AddFile(defpool, upb_file, status)) return nullptr;
  return upb_DefPool_FindMessageByName(defpool, "asan_validator.Root");
}

size_t CountPaths(upb_FieldPathEntry* entries) {
  size_t count = 0;
  while (entries && entries->field) {
    while (entries->field) ++entries;
    ++count;
    ++entries;
  }
  return count;
}

void PrintSamplePaths(upb_FieldPathEntry* entries, size_t max_paths) {
  char buf[256];
  size_t emitted = 0;
  while (entries && entries->field && emitted < max_paths) {
    upb_FieldPathEntry* cursor = entries;
    const size_t len = upb_FieldPath_ToText(&cursor, buf, sizeof(buf));
    std::cout << "path[" << emitted << "] len=" << len << " " << buf << "\n";
    entries = cursor;
    ++emitted;
  }
}

}  // namespace

int main(int argc, char** argv) {
  size_t repeated_count = 1000000;
  if (argc > 1) repeated_count = std::strtoull(argv[1], nullptr, 10);

  std::cout << "sizeof(upb_FieldPathEntry)=" << sizeof(upb_FieldPathEntry) << "\n";
  std::cout << "entries_to_cross_INT_MAX="
            << (static_cast<unsigned long long>(std::numeric_limits<int>::max()) /
                sizeof(upb_FieldPathEntry))
            << "\n";
  std::cout << "approx_missing_paths_to_cross_INT_MAX="
            << (static_cast<unsigned long long>(std::numeric_limits<int>::max()) /
                sizeof(upb_FieldPathEntry) / 4)
            << "\n";
  std::cout << "requested_repeated_count=" << repeated_count << "\n";

  upb_Arena* arena = upb_Arena_New();
  if (!arena) {
    std::cerr << "failed to allocate arena\n";
    return 2;
  }

  upb_DefPool* defpool = upb_DefPool_New();
  if (!defpool) {
    std::cerr << "failed to allocate defpool\n";
    upb_Arena_Free(arena);
    return 2;
  }

  upb_Status status;
  upb_Status_Clear(&status);
  const upb_MessageDef* root_def = BuildLinearDef(defpool, arena, &status);
  if (!root_def) {
    std::cerr << "failed to build def: " << upb_Status_ErrorMessage(&status)
              << "\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  const upb_FieldDef* required_field =
      upb_MessageDef_FindFieldByName(root_def, "required_message");
  const upb_FieldDef* repeated_field =
      upb_MessageDef_FindFieldByName(root_def, "repeated_message");
  const upb_MessageDef* missing_def =
      required_field ? upb_FieldDef_MessageSubDef(required_field) : nullptr;
  if (!required_field || !repeated_field || !missing_def) {
    std::cerr << "failed to locate fields\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  upb_Message* root = upb_Message_New(upb_MessageDef_MiniTable(root_def), arena);
  if (!root) {
    std::cerr << "failed to allocate root message\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  upb_Message* required_message =
      upb_Message_New(upb_MessageDef_MiniTable(missing_def), arena);
  if (!required_message) {
    std::cerr << "failed to allocate required_message\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  upb_MessageValue required_value = upb_MessageValue_Zero();
  required_value.msg_val = required_message;
  if (!upb_Message_SetFieldByDef(root, required_field, required_value, arena)) {
    std::cerr << "failed to set required_message\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  upb_Array* children = upb_Message_Mutable(root, repeated_field, arena).array;
  if (!children) {
    std::cerr << "failed to create repeated_message array\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  for (size_t i = 0; i < repeated_count; ++i) {
    upb_Message* child =
        upb_Message_New(upb_MessageDef_MiniTable(missing_def), arena);
    if (!child) {
      std::cerr << "child allocation failed at index " << i << "\n";
      upb_DefPool_Free(defpool);
      upb_Arena_Free(arena);
      return 3;
    }

    upb_MessageValue elem = upb_MessageValue_Zero();
    elem.msg_val = child;
    if (!upb_Array_Append(children, elem, arena)) {
      std::cerr << "array append failed at index " << i << "\n";
      upb_DefPool_Free(defpool);
      upb_Arena_Free(arena);
      return 3;
    }
  }

  upb_FieldPathEntry* fields = nullptr;
  const bool has_missing =
      upb_util_HasUnsetRequired(root, root_def, defpool, &fields);
  std::cout << "has_missing=" << has_missing << "\n";

  if (fields) {
    const size_t path_count = CountPaths(fields);
    std::cout << "path_count=" << path_count << "\n";
    PrintSamplePaths(fields, 3);
    std::free(fields);
  } else {
    std::cout << "fields_ptr=null\n";
  }

  upb_DefPool_Free(defpool);
  upb_Arena_Free(arena);
  return 0;
}
