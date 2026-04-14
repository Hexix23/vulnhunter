#include <stdio.h>
#include <string.h>

#include <vector>

#include <openthread/link.h>
#include <openthread/srp_client_buffers.h>
#include <openthread/thread.h>

#include "common/code_utils.hpp"
#include "lib/spinel/spinel_buffer.hpp"
#include "lib/spinel/spinel_decoder.hpp"
#include "lib/spinel/spinel_encoder.hpp"
#include "ncp/ncp_base.hpp"
#include "test_platform.h"
#include "test_util.h"

namespace {

constexpr uint16_t kMaxSpinelBufferSize = 2048;

class TestNcp : public ot::Ncp::NcpBase
{
public:
    explicit TestNcp(ot::Instance *aInstance)
        : NcpBase(aInstance)
        , mResponseLength(0)
    {
        memset(mResponse, 0, sizeof(mResponse));
        mTxFrameBuffer.SetFrameAddedCallback(HandleFrameAddedToNcpBuffer, this);
        mTxFrameBuffer.SetFrameRemovedCallback(nullptr, this);
    }

    void Receive(const uint8_t *aBuffer, uint16_t aLength)
    {
        HandleReceive(const_cast<uint8_t *>(aBuffer), aLength);
    }

    bool ParseLastStatus(unsigned int &aStatus) const
    {
        ot::Spinel::Decoder decoder;
        uint8_t             header;
        unsigned int        command;
        unsigned int        property;

        decoder.Init(mResponse, mResponseLength);

        VerifyOrExit(decoder.ReadUint8(header) == OT_ERROR_NONE);
        VerifyOrExit(decoder.ReadUintPacked(command) == OT_ERROR_NONE);
        VerifyOrExit(decoder.ReadUintPacked(property) == OT_ERROR_NONE);
        VerifyOrExit(command == SPINEL_CMD_PROP_VALUE_IS);
        VerifyOrExit(property == SPINEL_PROP_LAST_STATUS);
        VerifyOrExit(decoder.ReadUintPacked(aStatus) == OT_ERROR_NONE);

        return true;

    exit:
        return false;
    }

private:
    static void HandleFrameAddedToNcpBuffer(void                    *aContext,
                                            ot::Spinel::Buffer::FrameTag,
                                            ot::Spinel::Buffer::Priority,
                                            ot::Spinel::Buffer          *aBuffer)
    {
        static_cast<TestNcp *>(aContext)->HandleFrameAddedToNcpBuffer(*aBuffer);
    }

    void HandleFrameAddedToNcpBuffer(ot::Spinel::Buffer &aBuffer)
    {
        memset(mResponse, 0, sizeof(mResponse));
        SuccessOrQuit(aBuffer.OutFrameBegin());
        mResponseLength = aBuffer.OutFrameGetLength();
        VerifyOrQuit(mResponseLength <= sizeof(mResponse));
        VerifyOrQuit(aBuffer.OutFrameRead(mResponseLength, mResponse) == mResponseLength);
        SuccessOrQuit(aBuffer.OutFrameRemove());
    }

    uint8_t  mResponse[kMaxSpinelBufferSize];
    uint16_t mResponseLength;
};

otError BuildSetUintPackedFrame(spinel_prop_key_t aProperty, unsigned int aValue, std::vector<uint8_t> &aFrame)
{
    otError            error = OT_ERROR_NONE;
    uint8_t            buffer[kMaxSpinelBufferSize];
    ot::Spinel::Buffer spinelBuffer(buffer, sizeof(buffer));
    ot::Spinel::Encoder encoder(spinelBuffer);
    uint8_t header = SPINEL_HEADER_FLAG | SPINEL_HEADER_IID_0 | 1;

    SuccessOrExit(error = encoder.BeginFrame(header, SPINEL_CMD_PROP_VALUE_SET, aProperty));
    SuccessOrExit(error = encoder.WriteUintPacked(aValue));
    SuccessOrExit(error = encoder.EndFrame());
    SuccessOrExit(spinelBuffer.OutFrameBegin());

    aFrame.resize(spinelBuffer.OutFrameGetLength());
    VerifyOrExit(spinelBuffer.OutFrameRead(static_cast<uint16_t>(aFrame.size()), aFrame.data()) == aFrame.size(),
                 error = OT_ERROR_FAILED);

exit:
    return error;
}

otError BuildSetUint32Frame(spinel_prop_key_t aProperty, uint32_t aValue, std::vector<uint8_t> &aFrame)
{
    otError            error = OT_ERROR_NONE;
    uint8_t            buffer[kMaxSpinelBufferSize];
    ot::Spinel::Buffer spinelBuffer(buffer, sizeof(buffer));
    ot::Spinel::Encoder encoder(spinelBuffer);
    uint8_t header = SPINEL_HEADER_FLAG | SPINEL_HEADER_IID_0 | 1;

    SuccessOrExit(error = encoder.BeginFrame(header, SPINEL_CMD_PROP_VALUE_SET, aProperty));
    SuccessOrExit(error = encoder.WriteUint32(aValue));
    SuccessOrExit(error = encoder.EndFrame());
    SuccessOrExit(spinelBuffer.OutFrameBegin());

    aFrame.resize(spinelBuffer.OutFrameGetLength());
    VerifyOrExit(spinelBuffer.OutFrameRead(static_cast<uint16_t>(aFrame.size()), aFrame.data()) == aFrame.size(),
                 error = OT_ERROR_FAILED);

exit:
    return error;
}

otError BuildRemoveSrpServiceFrame(const char *aServiceName,
                                   const char *aInstanceName,
                                   bool        aToClear,
                                   std::vector<uint8_t> &aFrame)
{
    otError            error = OT_ERROR_NONE;
    uint8_t            buffer[kMaxSpinelBufferSize];
    ot::Spinel::Buffer spinelBuffer(buffer, sizeof(buffer));
    ot::Spinel::Encoder encoder(spinelBuffer);
    uint8_t header = SPINEL_HEADER_FLAG | SPINEL_HEADER_IID_0 | 1;

    SuccessOrExit(error = encoder.BeginFrame(header, SPINEL_CMD_PROP_VALUE_REMOVE, SPINEL_PROP_SRP_CLIENT_SERVICES));
    SuccessOrExit(error = encoder.WriteUtf8(aServiceName));
    SuccessOrExit(error = encoder.WriteUtf8(aInstanceName));
    SuccessOrExit(error = encoder.WriteBool(aToClear));
    SuccessOrExit(error = encoder.EndFrame());
    SuccessOrExit(spinelBuffer.OutFrameBegin());

    aFrame.resize(spinelBuffer.OutFrameGetLength());
    VerifyOrExit(spinelBuffer.OutFrameRead(static_cast<uint16_t>(aFrame.size()), aFrame.data()) == aFrame.size(),
                 error = OT_ERROR_FAILED);

exit:
    return error;
}

void CopyString(char *aDest, uint16_t aSize, const char *aSrc)
{
    VerifyOrQuit(strlen(aSrc) + 1 <= aSize);
    strcpy(aDest, aSrc);
}

bool ValidatePhyChannelWrap(void)
{
    ot::Instance         *instance = testInitInstance();
    TestNcp               ncp(instance);
    std::vector<uint8_t>  frame;
    unsigned int          lastStatus = SPINEL_STATUS_OK;
    const unsigned int    requestedChannel = 268;
    const uint8_t         wrappedChannel = static_cast<uint8_t>(requestedChannel);
    bool                  reproduced;

    SuccessOrQuit(otLinkSetChannel(instance, 11));
    SuccessOrQuit(BuildSetUintPackedFrame(SPINEL_PROP_PHY_CHAN, requestedChannel, frame));
    ncp.Receive(frame.data(), static_cast<uint16_t>(frame.size()));

    ncp.ParseLastStatus(lastStatus);
    reproduced = (lastStatus == SPINEL_STATUS_OK) && (otLinkGetChannel(instance) == wrappedChannel);

    printf("[phy-chan-wrap] requested=%u observed=%u status=%u\n", requestedChannel, otLinkGetChannel(instance),
           lastStatus);

    testFreeInstance(instance);
    return reproduced;
}

bool ValidateKeyGuardTimeWrap(void)
{
    ot::Instance         *instance = testInitInstance();
    TestNcp               ncp(instance);
    std::vector<uint8_t>  frame;
    unsigned int          lastStatus = SPINEL_STATUS_OK;
    const uint32_t        requestedGuardTime = 70000;
    const uint16_t        wrappedGuardTime = static_cast<uint16_t>(requestedGuardTime);
    bool                  reproduced;

    otThreadSetKeySwitchGuardTime(instance, 1);
    SuccessOrQuit(BuildSetUint32Frame(SPINEL_PROP_NET_KEY_SWITCH_GUARDTIME, requestedGuardTime, frame));
    ncp.Receive(frame.data(), static_cast<uint16_t>(frame.size()));

    ncp.ParseLastStatus(lastStatus);
    reproduced = (lastStatus == SPINEL_STATUS_OK) && (otThreadGetKeySwitchGuardTime(instance) == wrappedGuardTime);

    printf("[key-guard-wrap] requested=%lu observed=%u status=%u\n", static_cast<unsigned long>(requestedGuardTime),
           otThreadGetKeySwitchGuardTime(instance), lastStatus);

    testFreeInstance(instance);
    return reproduced;
}

bool ValidateSrpServiceWrongRemoval(void)
{
    ot::Instance                   *instance = testInitInstance();
    TestNcp                         ncp(instance);
    std::vector<uint8_t>            frame;
    otSrpClientBuffersServiceEntry *alphaEntry = nullptr;
    otSrpClientBuffersServiceEntry *betaEntry = nullptr;
    uint16_t                        size;
    bool                            reproduced;

    alphaEntry = otSrpClientBuffersAllocateService(instance);
    betaEntry  = otSrpClientBuffersAllocateService(instance);

    VerifyOrQuit(alphaEntry != nullptr && betaEntry != nullptr);

    CopyString(otSrpClientBuffersGetServiceEntryServiceNameString(alphaEntry, &size), size, "_test._udp");
    CopyString(otSrpClientBuffersGetServiceEntryInstanceNameString(alphaEntry, &size), size, "alpha");
    alphaEntry->mService.mPort = 1111;

    CopyString(otSrpClientBuffersGetServiceEntryServiceNameString(betaEntry, &size), size, "_test._udp");
    CopyString(otSrpClientBuffersGetServiceEntryInstanceNameString(betaEntry, &size), size, "beta");
    betaEntry->mService.mPort = 2222;

    SuccessOrQuit(otSrpClientAddService(instance, &alphaEntry->mService));
    SuccessOrQuit(otSrpClientAddService(instance, &betaEntry->mService));

    SuccessOrQuit(BuildRemoveSrpServiceFrame("_test._udp", "alpha", false, frame));
    ncp.Receive(frame.data(), static_cast<uint16_t>(frame.size()));

    reproduced = (alphaEntry->mService.mState == OT_SRP_CLIENT_ITEM_STATE_TO_ADD) &&
                 (betaEntry->mService.mState == OT_SRP_CLIENT_ITEM_STATE_TO_REMOVE);

    printf("[srp-remove-wrong-match] requested=alpha/_test._udp alpha_state=%s beta_state=%s head=%s/%s\n",
           otSrpClientItemStateToString(alphaEntry->mService.mState),
           otSrpClientItemStateToString(betaEntry->mService.mState),
           otSrpClientGetServices(instance)->mInstanceName, otSrpClientGetServices(instance)->mName);

    otSrpClientBuffersFreeAllServices(instance);
    testFreeInstance(instance);
    return reproduced;
}

} // namespace

int main(void)
{
    bool phyChannelWrap   = ValidatePhyChannelWrap();
    bool keyGuardWrap     = ValidateKeyGuardTimeWrap();
    bool wrongSrpRemoval  = ValidateSrpServiceWrongRemoval();

    printf("[summary] phy_channel_wrap=%s key_guard_wrap=%s srp_wrong_removal=%s\n",
           phyChannelWrap ? "reproduced" : "not-reproduced",
           keyGuardWrap ? "reproduced" : "not-reproduced",
           wrongSrpRemoval ? "reproduced" : "not-reproduced");

    return (phyChannelWrap && keyGuardWrap && wrongSrpRemoval) ? 0 : 1;
}
