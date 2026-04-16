#include <cstddef>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

#include <mach/mach.h>

#include "google/protobuf/any.pb.h"
#include "google/protobuf/descriptor.pb.h"
#include "google/protobuf/json/json.h"

namespace {

constexpr std::size_t kTargetRepeatedBytes = 50ULL * 1024ULL * 1024ULL;
constexpr std::size_t kElementPayloadBytes = 1024ULL;

std::string FormatBytes(std::uint64_t bytes) {
  static constexpr const char* kUnits[] = {"B", "KiB", "MiB", "GiB"};
  double value = static_cast<double>(bytes);
  std::size_t unit = 0;
  while (value >= 1024.0 && unit + 1 < (sizeof(kUnits) / sizeof(kUnits[0]))) {
    value /= 1024.0;
    ++unit;
  }

  std::ostringstream out;
  out << std::fixed << std::setprecision(unit == 0 ? 0 : 2) << value << " "
      << kUnits[unit];
  return out.str();
}

std::uint64_t GetResidentBytes() {
  mach_task_basic_info info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  const kern_return_t kr =
      task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                reinterpret_cast<task_info_t>(&info), &count);
  if (kr != KERN_SUCCESS) {
    return 0;
  }
  return static_cast<std::uint64_t>(info.resident_size);
}

std::string BuildLargeAnyJson() {
  const std::string type_url =
      "type.googleapis.com/google.protobuf.FileDescriptorSet";
  const std::string element(kElementPayloadBytes, 'A');

  std::string json;
  json.reserve(kTargetRepeatedBytes + (8ULL * 1024ULL * 1024ULL));
  json.append("{\"@type\":\"");
  json.append(type_url);
  json.append("\",\"file\":[");

  std::size_t repeated_bytes = 0;
  bool first = true;
  while (repeated_bytes < kTargetRepeatedBytes) {
    if (!first) {
      json.push_back(',');
    }
    first = false;
    json.append("{\"name\":\"");
    json.append(element);
    json.append("\"}");
    repeated_bytes += element.size();
  }

  json.append("]}");
  return json;
}

}  // namespace

int main() {
  // Force the generated descriptor path for FileDescriptorSet to be linked and
  // registered before JsonStringToMessage resolves the Any type URL.
  google::protobuf::FileDescriptorSet force_descriptor_link;
  (void)force_descriptor_link;

  std::string json = BuildLargeAnyJson();
  std::cout << "Generated Any JSON payload bytes: " << json.size() << " ("
            << FormatBytes(json.size()) << ")\n";
  std::cout << "Expected ParseAny marked-buffer bytes: " << json.size() << " ("
            << FormatBytes(json.size()) << ")\n";

  const std::uint64_t rss_before = GetResidentBytes();

  google::protobuf::Any message;
  const absl::Status status =
      google::protobuf::json::JsonStringToMessage(json, &message);

  const std::uint64_t rss_after = GetResidentBytes();
  const std::uint64_t rss_delta =
      rss_after >= rss_before ? rss_after - rss_before : 0;

  std::cout << "Parse status: " << status.ToString() << "\n";
  std::cout << "Resident memory before parse: " << rss_before << " ("
            << FormatBytes(rss_before) << ")\n";
  std::cout << "Resident memory after parse: " << rss_after << " ("
            << FormatBytes(rss_after) << ")\n";
  std::cout << "Resident memory delta: " << rss_delta << " ("
            << FormatBytes(rss_delta) << ")\n";
  std::cout << "Parsed type_url bytes: " << message.type_url().size() << "\n";
  std::cout << "Parsed embedded value bytes: " << message.value().size() << " ("
            << FormatBytes(message.value().size()) << ")\n";

  return status.ok() ? 0 : 1;
}
