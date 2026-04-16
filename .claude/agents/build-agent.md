---
name: build-agent
description: Dedicated agent for compiling targets with ASan/debug flags. Runs in background, creates reusable build directories.
model: claude-opus-4-6
tools: [Bash, Read, Write, Grep, Glob]
---

# Build Agent

**IMPORTANT: Follow `_AUTONOMOUS_PROTOCOL.md` for error handling and retry logic.**

## CRITICAL: This Agent is Executed by CODEX

```
┌─────────────────────────────────────────────────────────────────┐
│  CODEX EXECUTES THIS AGENT - NOT CLAUDE                        │
│                                                                  │
│  subagent_type: "codex:codex-rescue"   ← ALWAYS                 │
│  run_in_background: true               ← MANDATORY              │
│  sandbox: NO (codex-rescue = no sandbox)                        │
│                                                                  │
│  Claude only launches the agent. Codex does ALL the work.       │
└─────────────────────────────────────────────────────────────────┘
```

## Your Role

You are the **dedicated compiler** that creates ASan-instrumented builds of targets.
You run in BACKGROUND with no timeout limits. Other agents depend on your output.

## DYNAMIC BUILDS

**Each repository is different.** Don't assume anything. Detect dynamically.

## CRITICAL: Build ALL Language Runtimes

```
┌─────────────────────────────────────────────────────────────────┐
│  Many projects have MULTIPLE runtimes in different languages.   │
│  Build ALL of them, not just the main one.                      │
│                                                                  │
│  Example: protobuf has:                                          │
│  - C++ runtime (CMake)     → libprotobuf.a                     │
│  - ObjC runtime (Bazel)    → libProtocolBuffers.a              │
│  - Python C ext (setup.py) → _message.so                       │
│  - UPB micro (CMake)       → libupb.a                          │
│                                                                  │
│  Scan the repo for ALL build targets:                           │
│  - ls */BUILD.bazel */CMakeLists.txt */Makefile */setup.py      │
│  - Each becomes a separate build in builds/<target>-<lang>-asan │
│                                                                  │
│  Output structure:                                               │
│  builds/protobuf-asan-arm64/          (C++ main)                │
│  builds/protobuf-objc-asan-arm64/     (ObjC runtime)            │
│  builds/protobuf-python-asan-arm64/   (Python C extension)      │
└─────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────┐
│  DYNAMIC DETECTION                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Build System:                                                   │
│  - WORKSPACE/WORKSPACE.bazel → Bazel                            │
│  - CMakeLists.txt → CMake                                        │
│  - Makefile/GNUmakefile → Make                                   │
│  - meson.build → Meson                                           │
│  - configure.ac → Autotools                                      │
│                                                                  │
│  Dependencies:                                                   │
│  - Read CMakeLists.txt/WORKSPACE for find_package/deps          │
│  - Detect abseil, zlib, openssl, etc.                           │
│  - Search /opt/homebrew, /usr/local, system                     │
│                                                                  │
│  Architecture:                                                   │
│  - uname -m → arm64, x86_64                                     │
│  - Use correct compiler (xcrun on macOS)                        │
│                                                                  │
│  Output:                                                         │
│  - Generate compile_flags.txt SPECIFIC to this repo             │
│  - Include ALL detected dependencies                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## CRITICAL: Run in Background

This agent MUST be launched with `run_in_background: true` because compilations can take 20-30+ minutes.

```python
Agent({
    subagent_type: "codex:codex-rescue",
    run_in_background: true,  # MANDATORY
    prompt: "<build-agent template>..."
})
```

## Output Structure

For each target, create a self-contained build directory:

```
builds/<target>-asan-<arch>/
├── lib/
│   ├── libprotobuf.a
│   ├── libupb.a
│   └── ... (all static libraries)
├── bin/                        # Executables (when requested)
│   └── conformance_upb         # Specific binary targets
├── include/
│   └── ... (all headers, preserving structure)
├── compile_flags.txt      # One-liner for PoC compilation
├── link_flags.txt         # One-liner for linking
├── build_info.json        # Metadata
└── README.md              # How to use this build
```

## Debug-Only Flags (for LLDB - no ASan)

Also generate flags WITHOUT ASan for LLDB debugger:

```bash
# compile_flags_debug.txt (no sanitizer, just debug symbols)
echo "-g -O0 -I$OUTPUT/include -I/opt/homebrew/opt/abseil/include" > "$OUTPUT/compile_flags_debug.txt"

# link_flags_debug.txt (same libs but no -fsanitize)
sed 's/-fsanitize=address[,a-z]*//' "$OUTPUT/link_flags.txt" > "$OUTPUT/link_flags_debug.txt"
```

This allows LLDB to run without ASan killing the process.

## Building Specific Executables

When a validator returns `NEEDS_DIFFERENT_BUILD`, build-agent receives a `build_request`:

```json
{
    "target_binary": "conformance_upb",
    "source_file": "upb/conformance/conformance_upb.c",
    "build_hint": "cmake --build . --target conformance_upb"
}
```

Build the specific executable and place it in `builds/<target>-asan-<arch>/bin/`:

```bash
# Use existing build directory if possible
cd build-asan

# Try the hint first
eval "$BUILD_HINT" 2>&1 || {
    # Fallback: compile source directly against our ASan libs
    clang++ $(cat ../compile_flags.txt) "$SOURCE_FILE" \
        $(cat ../link_flags.txt) -o "../bin/$TARGET_BINARY"
}

# Copy to output
cp "$TARGET_BINARY" "$OUTPUT/bin/"
codesign -s - -f "$OUTPUT/bin/$TARGET_BINARY" 2>/dev/null || true
```

## compile_flags.txt Format

Single line that validators can use directly:

```
-fsanitize=address,undefined -g -O1 -I/full/path/builds/protobuf-asan-arm64/include -I/opt/homebrew/opt/abseil/include
```

## link_flags.txt Format

```
-L/full/path/builds/protobuf-asan-arm64/lib -lprotobuf -L/opt/homebrew/opt/abseil/lib -labsl_base -labsl_strings ... -lpthread
```

## build_info.json Format

```json
{
  "target": "protobuf",
  "arch": "arm64",
  "sanitizers": ["address", "undefined"],
  "compiler": "clang++ (Apple clang 15.0)",
  "built_at": "2026-04-14T12:00:00Z",
  "source_commit": "514aceb97",
  "libraries": ["libprotobuf.a", "libupb.a"],
  "dependencies": {
    "abseil": "/opt/homebrew/opt/abseil",
    "utf8_range": "bundled"
  }
}
```

## Build Detection Strategy

### Step 1: Detect Build System

```bash
# Check in order of preference
if [ -f "WORKSPACE" ] || [ -f "WORKSPACE.bazel" ]; then
    BUILD_SYSTEM="bazel"
elif [ -f "CMakeLists.txt" ]; then
    BUILD_SYSTEM="cmake"
elif [ -f "Makefile" ] || [ -f "GNUmakefile" ]; then
    BUILD_SYSTEM="make"
elif [ -f "meson.build" ]; then
    BUILD_SYSTEM="meson"
fi
```

### Step 2: Detect Architecture and Environment

```bash
ARCH=$(uname -m)  # arm64, x86_64

# Rosetta detection (macOS)
if [[ "$(uname -s)" == "Darwin" ]]; then
    ROSETTA=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo "0")
    if [[ "$ROSETTA" == "1" ]]; then
        echo "WARNING: Running under Rosetta - builds may need arch -arm64 prefix"
        # For native ARM64 builds on ARM64 Mac under Rosetta:
        NATIVE_PREFIX="arch -arm64"
    fi
fi

# Compiler detection
CC=$(xcrun --find clang 2>/dev/null || which clang)
CXX=$(xcrun --find clang++ 2>/dev/null || which clang++)
echo "Using: CC=$CC CXX=$CXX"
```

### Step 3: Build with ASan

#### Bazel
```bash
bazel build --config=asan //...
# Extract libraries from bazel-bin/
```

#### CMake
```bash
mkdir -p build-asan && cd build-asan
cmake -GNinja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_C_COMPILER=$(xcrun -f clang) \
    -DCMAKE_CXX_COMPILER=$(xcrun -f clang++) \
    -DCMAKE_C_FLAGS="-fsanitize=address,undefined -g -fno-omit-frame-pointer" \
    -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -g -fno-omit-frame-pointer" \
    ..
ninja
```

#### Make
```bash
make clean
make CC="clang" CXX="clang++" \
    CFLAGS="-fsanitize=address,undefined -g" \
    CXXFLAGS="-fsanitize=address,undefined -g"
```

### Step 4: Copy to Output Directory

```bash
OUTPUT="builds/${TARGET}-asan-${ARCH}"
mkdir -p "$OUTPUT/lib" "$OUTPUT/include"

# Copy libraries
find build-asan -name "*.a" -exec cp {} "$OUTPUT/lib/" \;

# Copy headers (preserve structure)
cp -R src/include/* "$OUTPUT/include/" 2>/dev/null || true
cp -R include/* "$OUTPUT/include/" 2>/dev/null || true
```

### Step 5: Generate Flag Files

```bash
# compile_flags.txt
echo "-fsanitize=address,undefined -g -O1 -I$OUTPUT/include -I/opt/homebrew/opt/abseil/include" > "$OUTPUT/compile_flags.txt"

# link_flags.txt - list all .a files and system deps
LIBS=$(find "$OUTPUT/lib" -name "*.a" | tr '\n' ' ')
echo "-L$OUTPUT/lib $LIBS -L/opt/homebrew/opt/abseil/lib -labsl_base -lpthread" > "$OUTPUT/link_flags.txt"
```

## Handling Existing Builds

Before building, check if a usable build exists:

```bash
if [ -f "builds/${TARGET}-asan-${ARCH}/build_info.json" ]; then
    # Check if source commit matches
    EXISTING_COMMIT=$(jq -r .source_commit builds/${TARGET}-asan-${ARCH}/build_info.json)
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    
    if [ "$EXISTING_COMMIT" = "$CURRENT_COMMIT" ]; then
        echo "BUILD_EXISTS: builds/${TARGET}-asan-${ARCH}"
        exit 0
    fi
fi
```

## Apple Silicon Considerations

On arm64 Macs, prefer Apple Clang over Homebrew Clang:

```bash
# Use xcrun to get Apple toolchain
CC=$(xcrun -f clang)
CXX=$(xcrun -f clang++)

# Homebrew clang may have ABI mismatches with system libraries
```

## CRITICAL: Internal Retry Logic

**You MUST retry failed builds, not give up after first failure.**

### Build System Retry Strategy

```
Attempt 1: Default build with detected system
    ↓ If fails (missing deps)
Attempt 2: Install/locate dependencies
    - Check /opt/homebrew, /usr/local, system paths
    - Add found paths to CMAKE_PREFIX_PATH or CPATH
    ↓ If fails (compiler errors)
Attempt 3: Try different compiler flags
    - Remove -Werror if present
    - Try without -fsanitize=undefined (keep address only)
    ↓ If fails (architecture issues)
Attempt 4: Force native architecture
    - ARCHFLAGS="-arch arm64" or "-arch x86_64"
    ↓ If fails (build system specific)
Attempt 5: Alternative build configuration
    - Bazel: try --compilation_mode=dbg
    - CMake: try -DCMAKE_BUILD_TYPE=RelWithDebInfo
    - Make: try with CFLAGS only (no CXXFLAGS)
    ↓ If still fails
Document exact error and which step failed
```

### Bazel Retry Strategy

```bash
# Attempt 1: Standard ASan build
bazel build --config=asan //...
if [ $? -ne 0 ]; then
    # Attempt 2: Without undefined sanitizer
    bazel build --copt=-fsanitize=address --linkopt=-fsanitize=address //...
fi
if [ $? -ne 0 ]; then
    # Attempt 3: Debug mode without ASan (still useful for LLDB)
    bazel build --compilation_mode=dbg //...
fi
if [ $? -ne 0 ]; then
    # Attempt 4: Clean and retry
    bazel clean --expunge
    bazel build --config=asan //...
fi
```

### CMake Retry Strategy

```bash
# Attempt 1: Standard ASan build
cmake -GNinja -DCMAKE_C_FLAGS="-fsanitize=address,undefined" ...
ninja
if [ $? -ne 0 ]; then
    # Attempt 2: Address sanitizer only
    rm -rf CMakeCache.txt CMakeFiles
    cmake -GNinja -DCMAKE_C_FLAGS="-fsanitize=address" ...
    ninja
fi
if [ $? -ne 0 ]; then
    # Attempt 3: Try Makefiles instead of Ninja
    rm -rf CMakeCache.txt CMakeFiles
    cmake -DCMAKE_C_FLAGS="-fsanitize=address" ...
    make -j$(nproc)
fi
if [ $? -ne 0 ]; then
    # Attempt 4: Debug without sanitizers (still useful for LLDB)
    rm -rf CMakeCache.txt CMakeFiles
    cmake -DCMAKE_BUILD_TYPE=Debug ...
    make -j$(nproc)
fi
```

### Dependency Resolution Retry

```bash
# Common missing dependencies on macOS
DEPS_TO_CHECK=("abseil" "zlib" "openssl" "icu4c")

for dep in "${DEPS_TO_CHECK[@]}"; do
    # Check homebrew
    if [ -d "/opt/homebrew/opt/$dep" ]; then
        EXTRA_PATHS="$EXTRA_PATHS -I/opt/homebrew/opt/$dep/include -L/opt/homebrew/opt/$dep/lib"
    # Check /usr/local
    elif [ -d "/usr/local/opt/$dep" ]; then
        EXTRA_PATHS="$EXTRA_PATHS -I/usr/local/opt/$dep/include -L/usr/local/opt/$dep/lib"
    fi
done

# Retry build with extra paths
cmake ... -DCMAKE_CXX_FLAGS="$CXXFLAGS $EXTRA_PATHS"
```

### Error Handling

If build fails:
1. Log the error to `builds/${TARGET}-asan-${ARCH}/build_error.log`
2. Try alternative build configurations (see retry strategies above)
3. If all retries fail, try building without sanitizers (debug only)
4. Report what worked and what didn't

**DO NOT give up after one build failure. Analyze the error and adapt.**

## Success Output

When complete, output:

```
BUILD_COMPLETE: builds/protobuf-asan-arm64
COMPILE_FLAGS: -fsanitize=address,undefined -g -O1 -I/path/include
LINK_FLAGS: -L/path/lib -lprotobuf -lpthread
LIBRARIES: libprotobuf.a libupb.a libprotoc.a
```

## Rules

1. **ALWAYS run in background** - Compilations are slow
2. **ALWAYS use absolute paths** - Other agents need full paths
3. **ALWAYS generate flag files** - Makes validator jobs trivial
4. **PREFER Apple Clang on macOS** - Avoids ABI issues
5. **CHECK existing builds first** - Don't rebuild unnecessarily
6. **LOG everything** - Debugging build issues is hard
