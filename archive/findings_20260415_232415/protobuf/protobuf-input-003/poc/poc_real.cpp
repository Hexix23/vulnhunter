#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include "google/protobuf/descriptor.pb.h"
#include "google/protobuf/descriptor.upb.h"
#include "upb/base/status.h"
#include "upb/mem/arena.h"
#include "upb/message/array.h"
#include "upb/message/message.h"
#include "upb/message/value.h"
#include "upb/reflection/def.h"
#include "upb/reflection/message.h"
#include "upb/util/required_fields.h"

namespace {

struct ReserveSimulationResult {
  size_t entry_size;
  size_t original_cap;
  size_t original_size;
  size_t elems;
  size_t need;
  size_t raw_oldsize;
  int oldsize;
  size_t grown_cap;
  size_t raw_newsize;
  int newsize;
};

__attribute__((noinline)) ReserveSimulationResult SimulateReserveNarrowing(
    size_t initial_cap, size_t initial_size, size_t elems) {
  // Mirror upb_FieldPathVector_Reserve() exactly enough to inspect truncation.
  ReserveSimulationResult out{};
  out.entry_size = sizeof(upb_FieldPathEntry);
  out.original_cap = initial_cap;
  out.original_size = initial_size;
  out.elems = elems;

  size_t cap = out.original_cap;
  const size_t size = out.original_size;

  out.raw_oldsize = cap * out.entry_size;
  out.oldsize = static_cast<int>(out.raw_oldsize);
  out.need = size + out.elems;

  cap = std::max<size_t>(4, cap);
  while (cap < out.need) cap *= 2;

  out.grown_cap = cap;
  out.raw_newsize = cap * out.entry_size;
  out.newsize = static_cast<int>(out.raw_newsize);
  return out;
}

google_protobuf_FileDescriptorProto* ToUpbDescriptor(
    const google::protobuf::FileDescriptorProto& proto, upb_Arena* arena) {
  std::string serialized;
  if (!proto.SerializeToString(&serialized)) return nullptr;
  return google_protobuf_FileDescriptorProto_parse(serialized.data(),
                                                   serialized.size(), arena);
}

const upb_MessageDef* BuildRecursiveNodeDef(upb_DefPool* defpool,
                                            upb_Arena* arena,
                                            upb_Status* status) {
  google::protobuf::FileDescriptorProto file;
  file.set_name("asan_validator_required_fields.proto");
  file.set_package("asan_validator");
  file.set_syntax("proto2");

  auto* node = file.add_message_type();
  node->set_name("Node");

  auto* children = node->add_field();
  children->set_name("children");
  children->set_number(1);
  children->set_label(
      google::protobuf::FieldDescriptorProto::LABEL_REPEATED);
  children->set_type(
      google::protobuf::FieldDescriptorProto::TYPE_MESSAGE);
  children->set_type_name(".asan_validator.Node");

  auto* req = node->add_field();
  req->set_name("req");
  req->set_number(2);
  req->set_label(
      google::protobuf::FieldDescriptorProto::LABEL_REQUIRED);
  req->set_type(
      google::protobuf::FieldDescriptorProto::TYPE_INT32);

  google_protobuf_FileDescriptorProto* upb_file = ToUpbDescriptor(file, arena);
  if (!upb_file) return nullptr;
  if (!upb_DefPool_AddFile(defpool, upb_file, status)) return nullptr;
  return upb_DefPool_FindMessageByName(defpool, "asan_validator.Node");
}

bool SetInt32Field(upb_Message* msg, const upb_FieldDef* field, int32_t value,
                   upb_Arena* arena) {
  upb_MessageValue v = upb_MessageValue_Zero();
  v.int32_val = value;
  return upb_Message_SetFieldByDef(msg, field, v, arena);
}

bool BuildTree(upb_Message* node, const upb_MessageDef* node_def,
               const upb_FieldDef* children_field, const upb_FieldDef* req_field,
               size_t depth, size_t breadth, upb_Arena* arena,
               size_t* node_count) {
  ++*node_count;

  if (depth == 0) {
    return true;
  }

  if (!SetInt32Field(node, req_field, 1, arena)) return false;
  upb_Array* children = upb_Message_Mutable(node, children_field, arena).array;
  if (!children) return false;

  for (size_t i = 0; i < breadth; ++i) {
    upb_Message* child = upb_Message_New(upb_MessageDef_MiniTable(node_def), arena);
    if (!child) return false;
    if (!BuildTree(child, node_def, children_field, req_field, depth - 1,
                   breadth, arena, node_count)) {
      return false;
    }
    upb_MessageValue v = upb_MessageValue_Zero();
    v.msg_val = child;
    if (!upb_Array_Append(children, v, arena)) return false;
  }

  return true;
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

void PrintReserveNarrowingExample() {
  const ReserveSimulationResult result =
      SimulateReserveNarrowing(134217728ULL, 134217728ULL, 1);

  std::cerr << "=== CHECKPOINT: upb_FieldPathVector_Reserve narrowing ===\n";
  std::cerr << "[STATE] entry_size = " << result.entry_size << "\n";
  std::cerr << "[STATE] initial_cap = " << result.original_cap << "\n";
  std::cerr << "[STATE] initial_size = " << result.original_size << "\n";
  std::cerr << "[STATE] elems = " << result.elems << "\n";
  std::cerr << "[STATE] raw_oldsize = " << result.raw_oldsize << " (0x"
            << std::hex << result.raw_oldsize << std::dec << ")\n";
  std::cerr << "[STATE] oldsize_as_int = " << result.oldsize << " (0x"
            << std::hex << static_cast<unsigned int>(result.oldsize) << std::dec
            << ")\n";
  std::cerr << "[STATE] need = " << result.need << "\n";
  std::cerr << "[STATE] grown_cap = " << result.grown_cap << "\n";
  std::cerr << "[STATE] raw_newsize = " << result.raw_newsize << " (0x"
            << std::hex << result.raw_newsize << std::dec << ")\n";
  std::cerr << "[STATE] newsize_as_int = " << result.newsize << " (0x"
            << std::hex << static_cast<unsigned int>(result.newsize) << std::dec
            << ")\n";
  std::cerr << "[RESULT] "
            << ((result.newsize <= 0 ||
                 static_cast<size_t>(result.newsize) != result.raw_newsize)
                    ? "BUG: size_t to int narrowing corrupts allocation size"
                    : "OK")
            << "\n\n";
}

}  // namespace

int main(int argc, char** argv) {
  size_t depth = 2;
  size_t breadth = 1024;

  if (argc > 1) depth = std::strtoull(argv[1], nullptr, 10);
  if (argc > 2) breadth = std::strtoull(argv[2], nullptr, 10);

  PrintReserveNarrowingExample();

  std::cout << "depth=" << depth << " breadth=" << breadth << "\n";
  std::cout << "sizeof(upb_FieldPathEntry)=" << sizeof(upb_FieldPathEntry) << "\n";
  std::cout << "entries_to_cross_INT_MAX="
            << (static_cast<unsigned long long>(std::numeric_limits<int>::max()) /
                sizeof(upb_FieldPathEntry))
            << "\n";

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
  const upb_MessageDef* node_def = BuildRecursiveNodeDef(defpool, arena, &status);
  if (!node_def) {
    std::cerr << "failed to build def: " << upb_Status_ErrorMessage(&status)
              << "\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  const upb_FieldDef* children_field =
      upb_MessageDef_FindFieldByName(node_def, "children");
  const upb_FieldDef* req_field =
      upb_MessageDef_FindFieldByName(node_def, "req");
  if (!children_field || !req_field) {
    std::cerr << "failed to locate fields\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  upb_Message* root = upb_Message_New(upb_MessageDef_MiniTable(node_def), arena);
  if (!root) {
    std::cerr << "failed to allocate root message\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  size_t node_count = 0;
  if (!BuildTree(root, node_def, children_field, req_field, depth, breadth, arena,
                 &node_count)) {
    std::cerr << "failed to build tree\n";
    upb_DefPool_Free(defpool);
    upb_Arena_Free(arena);
    return 2;
  }

  std::cout << "node_count=" << node_count << "\n";
  upb_FieldPathEntry* fields = nullptr;
  const bool has_missing =
      upb_util_HasUnsetRequired(root, node_def, defpool, &fields);
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
