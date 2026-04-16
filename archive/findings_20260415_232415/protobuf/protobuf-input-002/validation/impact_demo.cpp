#include <cstdint>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct Scenario {
  std::string name;
  uint64_t logical_first_payload_size;
  std::vector<uint8_t> stream;
  std::string intended_next_frame;
};

void AppendLe32(std::vector<uint8_t>* out, uint32_t value) {
  out->push_back(static_cast<uint8_t>(value & 0xff));
  out->push_back(static_cast<uint8_t>((value >> 8) & 0xff));
  out->push_back(static_cast<uint8_t>((value >> 16) & 0xff));
  out->push_back(static_cast<uint8_t>((value >> 24) & 0xff));
}

uint32_t ReadLe32(const std::vector<uint8_t>& input, size_t* offset) {
  const size_t i = *offset;
  *offset += 4;
  return static_cast<uint32_t>(input[i]) |
         (static_cast<uint32_t>(input[i + 1]) << 8) |
         (static_cast<uint32_t>(input[i + 2]) << 16) |
         (static_cast<uint32_t>(input[i + 3]) << 24);
}

std::string ReadBytes(const std::vector<uint8_t>& input, size_t* offset,
                      size_t len) {
  std::string out;
  out.reserve(len);
  for (size_t i = 0; i < len; ++i) {
    out.push_back(static_cast<char>(input[*offset + i]));
  }
  *offset += len;
  return out;
}

std::string Hex(uint64_t value) {
  std::ostringstream oss;
  oss << "0x" << std::hex << value;
  return oss.str();
}

Scenario MakeCorruptionScenario() {
  Scenario scenario;
  scenario.name = "incorrect_processing";
  scenario.logical_first_payload_size = (1ULL << 32) + 4;
  scenario.intended_next_frame = "HELLO";

  AppendLe32(&scenario.stream, 4);
  scenario.stream.insert(scenario.stream.end(), {'O', 'K', 'A', 'Y'});

  // These bytes are really part of the oversized first payload, but after the
  // truncated 4-byte header the reader treats them as the next frame length.
  AppendLe32(&scenario.stream, 16);

  AppendLe32(&scenario.stream,
             static_cast<uint32_t>(scenario.intended_next_frame.size()));
  scenario.stream.insert(scenario.stream.end(),
                         scenario.intended_next_frame.begin(),
                         scenario.intended_next_frame.end());
  scenario.stream.insert(scenario.stream.end(),
                         {'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'});
  return scenario;
}

Scenario MakeStallScenario() {
  Scenario scenario;
  scenario.name = "service_disruption";
  scenario.logical_first_payload_size = (1ULL << 32) + 4;
  scenario.intended_next_frame = "HELLO";

  AppendLe32(&scenario.stream, 4);
  scenario.stream.insert(scenario.stream.end(), {'O', 'K', 'A', 'Y'});

  // 256 MiB bogus length decoded from leftover payload bytes.
  AppendLe32(&scenario.stream, 0x10000000U);

  AppendLe32(&scenario.stream,
             static_cast<uint32_t>(scenario.intended_next_frame.size()));
  scenario.stream.insert(scenario.stream.end(),
                         scenario.intended_next_frame.begin(),
                         scenario.intended_next_frame.end());
  return scenario;
}

void RunScenario(const Scenario& scenario) {
  const uint32_t truncated_header =
      static_cast<uint32_t>(scenario.logical_first_payload_size);
  const uint64_t truncation_delta =
      scenario.logical_first_payload_size - truncated_header;

  std::cout << "SCENARIO " << scenario.name << "\n";
  std::cout << "  logical_first_payload_size=" << scenario.logical_first_payload_size
            << " (" << Hex(scenario.logical_first_payload_size) << ")\n";
  std::cout << "  advertised_first_frame_length=" << truncated_header << " ("
            << Hex(truncated_header) << ")\n";
  std::cout << "  truncation_delta=" << truncation_delta << "\n";

  size_t offset = 0;
  const uint32_t first_len = ReadLe32(scenario.stream, &offset);
  const std::string first_payload =
      ReadBytes(scenario.stream, &offset, static_cast<size_t>(first_len));
  const uint32_t second_len = ReadLe32(scenario.stream, &offset);
  const size_t remaining = scenario.stream.size() - offset;

  std::cout << "  reader_frame_1_length=" << first_len << "\n";
  std::cout << "  reader_frame_1_payload=" << first_payload << "\n";
  std::cout << "  reader_next_length_from_leftover_payload=" << second_len
            << " (" << Hex(second_len) << ")\n";
  std::cout << "  bytes_remaining_after_poisoned_header=" << remaining << "\n";

  if (remaining >= second_len) {
    const std::string swallowed =
        ReadBytes(scenario.stream, &offset, static_cast<size_t>(second_len));
    std::cout << "  outcome=consumer_accepts_corrupted_second_frame\n";
    std::cout << "  corrupted_second_frame_payload_size=" << swallowed.size()
              << "\n";
    std::cout << "  intended_next_frame_payload=" << scenario.intended_next_frame
              << "\n";
    std::cout << "  observed_second_frame_prefix_hex=";
    for (unsigned char c : swallowed) {
      std::cout << std::hex << std::setw(2) << std::setfill('0')
                << static_cast<unsigned int>(c);
    }
    std::cout << std::dec << "\n";
    std::cout
        << "  note=the valid next frame is swallowed into the corrupted payload\n";
  } else {
    const uint64_t shortfall = second_len - remaining;
    std::cout << "  outcome=consumer_blocks_or_fails_waiting_for_more_bytes\n";
    std::cout << "  missing_bytes_before_second_frame_completes=" << shortfall
              << "\n";
    std::cout
        << "  note=ForkPipeRunner::CheckedRead would keep reading until timeout "
           "or EOF after trusting the poisoned length\n";
  }

  std::cout << "\n";
}

}  // namespace

int main() {
  RunScenario(MakeCorruptionScenario());
  RunScenario(MakeStallScenario());
  return 0;
}
