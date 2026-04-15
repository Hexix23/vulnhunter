#include <mach/mach.h>

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>

#include "absl/status/status.h"
#include "google/protobuf/any.pb.h"
#include "google/protobuf/io/zero_copy_stream_impl_lite.h"
#include "google/protobuf/json/internal/lexer.h"
#include "google/protobuf/json/internal/message_path.h"
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

void PrintHexSample(const std::string& label, const char* data, size_t len) {
  std::cout << label;
  for (size_t i = 0; i < len; ++i) {
    if (i != 0) {
      std::cout << ' ';
    }
    std::cout << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<unsigned>(
                     static_cast<unsigned char>(data[i]));
  }
  std::cout << std::dec << std::setfill(' ') << "\n";
}

}  // namespace

int main(int argc, char** argv) {
  size_t target_mb = 16;
  if (argc > 1) {
    target_mb = std::strtoull(argv[1], nullptr, 10);
  }

  const size_t target_bytes = target_mb * 1024ull * 1024ull;
  std::string json = MakeLargeAnyJson(target_bytes);

  google::protobuf::json_internal::ParseOptions internal_options;
  internal_options.allow_legacy_nonconformant_behavior = false;
  google::protobuf::json_internal::MessagePath path("google.protobuf.Any");
  google::protobuf::io::ArrayInputStream in(json.data(),
                                            static_cast<int>(json.size()));
  google::protobuf::json_internal::JsonLexer lex(&in, internal_options, &path);

  absl::Status status = lex.SkipToToken();
  if (!status.ok()) {
    std::cerr << "SkipToToken failed: " << status.ToString() << "\n";
    return 1;
  }

  auto mark = lex.BeginMark();
  std::string type_url;
  status = lex.VisitObject(
      [&](const google::protobuf::json_internal::LocationWith<
          google::protobuf::json_internal::MaybeOwnedString>& key)
          -> absl::Status {
        if (key.value == "@type") {
          auto maybe_url = lex.ParseUtf8();
          if (!maybe_url.ok()) {
            return maybe_url.status();
          }
          type_url = maybe_url->value.ToString();
          return absl::OkStatus();
        }
        return lex.SkipValue();
      });
  if (!status.ok()) {
    std::cerr << "VisitObject failed: " << status.ToString() << "\n";
    return 1;
  }

  google::protobuf::json_internal::MaybeOwnedString marked =
      mark.value.UpToUnread();
  const std::string any_text = marked.ToString();
  const size_t prefix_len = std::min<size_t>(32, any_text.size());
  const size_t suffix_len = std::min<size_t>(32, any_text.size());

  std::cout << "Generated Any JSON payload bytes: " << json.size() << "\n";
  std::cout << "Captured type_url: " << type_url << "\n";
  std::cout << "Captured type_url bytes: " << type_url.size() << "\n";
  std::cout << "mark.value.UpToUnread() bytes: " << any_text.size() << "\n";
  std::cout << "mark covers entire input: "
            << (any_text.size() == json.size() ? "true" : "false") << "\n";
  std::cout << "mark prefix ascii: "
            << any_text.substr(0, prefix_len) << "\n";
  std::cout << "mark suffix ascii: "
            << any_text.substr(any_text.size() - suffix_len, suffix_len) << "\n";
  PrintHexSample("mark prefix hex: ", any_text.data(), std::min<size_t>(16, any_text.size()));
  PrintHexSample("mark suffix hex: ",
                 any_text.data() + (any_text.size() - std::min<size_t>(16, any_text.size())),
                 std::min<size_t>(16, any_text.size()));

  google::protobuf::io::ArrayInputStream replay_in(any_text.data(),
                                                   static_cast<int>(any_text.size()));
  google::protobuf::json_internal::JsonLexer replay_lex(&replay_in, internal_options,
                                                        &path, mark.loc);
  status = replay_lex.SkipToToken();
  std::cout << "replay lexer SkipToToken: " << status.ToString() << "\n";

  google::protobuf::Any any;
  google::protobuf::json::ParseOptions public_options;
  public_options.allow_legacy_nonconformant_behavior = false;

  const uint64_t rss_before = CurrentRssBytes();
  absl::Status parse_status =
      google::protobuf::json::JsonStringToMessage(json, &any, public_options);
  const uint64_t rss_after = CurrentRssBytes();

  std::cout << std::fixed << std::setprecision(2);
  std::cout << "Resident memory before parse: " << rss_before << " ("
            << ToMiB(rss_before) << " MiB)\n";
  std::cout << "Resident memory after parse: " << rss_after << " ("
            << ToMiB(rss_after) << " MiB)\n";
  std::cout << "Resident memory delta: " << (rss_after - rss_before) << " ("
            << ToMiB(rss_after - rss_before) << " MiB)\n";
  std::cout << "JsonStringToMessage status: " << parse_status.ToString() << "\n";
  std::cout << "Parsed embedded value bytes: " << any.value().size() << "\n";

  return parse_status.ok() ? 0 : 1;
}
