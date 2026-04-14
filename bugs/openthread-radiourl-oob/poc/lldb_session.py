#!/usr/bin/env python3
import lldb
import sys

def main():
    debugger = lldb.SBDebugger.Create()
    debugger.SetAsync(False)

    target = debugger.CreateTarget("./radiourl_oob_debug")
    if not target:
        print("Failed to create target")
        return 1

    # Set breakpoint after strncpy in RadioUrl::Init
    bp = target.BreakpointCreateByLocation("radio_url.cpp", 153)
    print(f"Breakpoint set: {bp}")

    # Launch process
    process = target.LaunchSimple(["511"], None, None)
    if not process:
        print("Failed to launch process")
        return 1

    # Get the stopped thread and frame
    thread = process.GetSelectedThread()
    frame = thread.GetSelectedFrame()

    print("\n=== STOPPED AFTER strncpy() ===")
    print(f"Function: {frame.GetFunctionName()}")
    print(f"Line: {frame.GetLineEntry()}")

    # Get this pointer
    this_val = frame.FindVariable("this")
    print(f"\nthis = {this_val.GetValue()}")

    # Get mUrl buffer info
    print("\n=== mUrl BUFFER STATE ===")

    # Read mUrl bytes around position 510-512
    mUrl_addr = this_val.GetChildMemberWithName("mUrl").GetLoadAddress()
    error = lldb.SBError()

    print(f"mUrl address: {hex(mUrl_addr)}")
    print(f"sizeof(mUrl) = 512")

    # Read bytes 508-520 to show the boundary
    print("\n=== MEMORY AT BUFFER END (bytes 508-520) ===")
    for i in range(508, 520):
        byte = process.ReadMemory(mUrl_addr + i, 1, error)
        if byte:
            val = ord(byte)
            char = chr(val) if 32 <= val < 127 else '.'
            print(f"mUrl[{i}] = 0x{val:02x} ('{char}')")

    print("\n=== ANALYSIS ===")
    print("strncpy(mUrl, aUrl, 511) copies bytes 0-510")
    print("mUrl[511] is NOT set to null by strncpy!")
    print("If mUrl[511] != 0, strlen() will read past the buffer")

    process.Continue()

    return 0

if __name__ == "__main__":
    sys.exit(main())
