#include <mach/mach.h>

#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

#include "absl/status/status.h"
#include "google/protobuf/any.pb.h"
#include "google/protobuf/descriptor.pb.h"
#include "google/protobuf/json/json.h"

namespace {

uint64_t CurrentRssBytes() {
  mach_task_basic_info info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                reinterpret_cast<task_info_t>(&info), &count) != KERN_SUCCESS) {
    return 0;
  }
  return info.resident_size;
}

std::string MakeLargeAnyJson(size_t target_bytes) {
  const std::string prefix =
      R"({"@type":"type.googleapis.com/google.protobuf.FileDescriptorSet","file":[)";
  const std::string suffix = "]}";
  const std::string file_prefix = R"({"name":")";
  const std::string file_middle = R"(","package":"audit.pkg","syntax":"proto3"})";

  std::string payload;
  payload.reserve(target_bytes + 1024);
  payload.append(prefix);

  size_t counter = 0;
  while (payload.size() < target_bytes) {
    if (counter != 0) {
      payload.push_back(',');
    }
    payload.append(file_prefix);
    payload.append("f");
    payload.append(std::to_string(counter++));
    payload.append(std::string(240, 'A'));
    payload.append(".proto");
    payload.append(file_middle);
  }

  payload.append(suffix);
  return payload;
}

double ToMiB(uint64_t bytes) {
  return static_cast<double>(bytes) / (1024.0 * 1024.0);
}

}  // namespace

int main(int argc, char** argv) {
  size_t target_mb = 48;
  if (argc > 1) {
    target_mb = std::strtoull(argv[1], nullptr, 10);
  }
  const size_t target_bytes = target_mb * 1024ull * 1024ull;

  std::string json = MakeLargeAnyJson(target_bytes);
  google::protobuf::Any any;
  google::protobuf::json::ParseOptions options;
  options.allow_legacy_nonconformant_behavior = false;

  const uint64_t rss_before = CurrentRssBytes();
  absl::Status status = google::protobuf::json::JsonStringToMessage(
      json, &any, options);
  const uint64_t rss_after = CurrentRssBytes();

  std::cout << "Generated Any JSON payload bytes: " << json.size() << "\n";
  std::cout << std::fixed << std::setprecision(2);
  std::cout << "Resident memory before parse: " << rss_before << " ("
            << ToMiB(rss_before) << " MiB)\n";
  std::cout << "Resident memory after parse: " << rss_after << " ("
            << ToMiB(rss_after) << " MiB)\n";
  std::cout << "Resident memory delta: " << (rss_after - rss_before) << " ("
            << ToMiB(rss_after - rss_before) << " MiB)\n";
  std::cout << "Parse status: " << status.ToString() << "\n";
  std::cout << "Parsed type_url bytes: " << any.type_url().size() << "\n";
  std::cout << "Parsed embedded value bytes: " << any.value().size() << "\n";

  return status.ok() ? 0 : 1;
}
