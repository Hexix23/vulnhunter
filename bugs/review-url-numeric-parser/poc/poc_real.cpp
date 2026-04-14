#include <stdio.h>

#include "lib/url/url.hpp"

int main(void)
{
    ot::Url::Url url;
    uint32_t     value = 0;
    otError      error;
    bool         octalReproduced;
    bool         trailingGarbageReproduced;
    bool         emptyValueReproduced;

    char octalUrl[]    = "spinel:///dev/ttyUSB0?baudrate=09";
    char trailingUrl[] = "spinel:///dev/ttyUSB0?baudrate=12oops";
    char emptyUrl[]    = "spinel:///dev/ttyUSB0?baudrate=";

    error = url.Init(octalUrl);
    if (error != OT_ERROR_NONE)
    {
        printf("failed to init octal URL: %d\n", error);
        return 1;
    }

    error           = url.ParseUint32("baudrate", value);
    octalReproduced = (error == OT_ERROR_NONE) && (value == 0);
    printf("[url-octal] input=09 error=%d parsed=%lu\n", error, static_cast<unsigned long>(value));

    error = url.Init(trailingUrl);
    if (error != OT_ERROR_NONE)
    {
        printf("failed to init trailing URL: %d\n", error);
        return 1;
    }

    error                    = url.ParseUint32("baudrate", value);
    trailingGarbageReproduced = (error == OT_ERROR_NONE) && (value == 12);
    printf("[url-trailing-garbage] input=12oops error=%d parsed=%lu\n", error, static_cast<unsigned long>(value));

    error = url.Init(emptyUrl);
    if (error != OT_ERROR_NONE)
    {
        printf("failed to init empty URL: %d\n", error);
        return 1;
    }

    error               = url.ParseUint32("baudrate", value);
    emptyValueReproduced = (error == OT_ERROR_NONE) && (value == 0);
    printf("[url-empty-value] input=<empty> error=%d parsed=%lu\n", error, static_cast<unsigned long>(value));

    printf("[summary] octal=%s trailing_garbage=%s empty_value=%s\n",
           octalReproduced ? "reproduced" : "not-reproduced",
           trailingGarbageReproduced ? "reproduced" : "not-reproduced",
           emptyValueReproduced ? "reproduced" : "not-reproduced");

    return (octalReproduced && trailingGarbageReproduced && emptyValueReproduced) ? 0 : 1;
}
