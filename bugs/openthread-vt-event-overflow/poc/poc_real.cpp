#include <cstdio>
#include <cstdint>
#include <vector>

#include "posix/platform/platform-posix.h"

extern "C" void otPlatReset(otInstance *aInstance) { (void)aInstance; }

int main()
{
    std::vector<uint8_t> payload(OT_EVENT_DATA_MAX_SIZE + 1, 0x41);

    std::fprintf(stderr, "calling virtualTimeSendRadioSpinelWriteEvent with %zu bytes\n", payload.size());
    virtualTimeSendRadioSpinelWriteEvent(payload.data(), static_cast<uint16_t>(payload.size()));

    std::fprintf(stderr, "unexpectedly returned from virtualTimeSendRadioSpinelWriteEvent\n");
    return 0;
}
