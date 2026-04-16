#include <cstdio>

#include "posix/platform/platform-posix.h"

extern "C" void otPlatReset(otInstance *aInstance) { (void)aInstance; }

int main()
{
    const char *url = "spinel+hdlc+forkpty:///bin/echo";

    std::fprintf(stderr, "calling platformSpinelManagerInit with url=%s\n", url);
    platformSpinelManagerInit(url);

    std::fprintf(stderr, "unexpectedly returned from platformSpinelManagerInit\n");
    return 0;
}
