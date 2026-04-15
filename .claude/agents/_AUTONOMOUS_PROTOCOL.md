# Autonomous Agent Protocol

**ALL agents MUST include this protocol for self-sufficient operation.**

## Core Principle

```
┌─────────────────────────────────────────────────────────────┐
│  AUTONOMOUS = Complete the task WITHOUT human intervention  │
│                                                             │
│  If something fails:                                        │
│    1. Analyze WHY it failed                                 │
│    2. Try an ALTERNATIVE approach                           │
│    3. Document what worked and what didn't                  │
│    4. Only report NEEDS_MANUAL if ALL alternatives fail     │
│                                                             │
│  NEVER give up after first failure.                         │
│  NEVER ask for help before trying alternatives.             │
└─────────────────────────────────────────────────────────────┘
```

## Platform Detection (MANDATORY FIRST STEP)

```bash
# Detect environment BEFORE any work
detect_environment() {
    echo "=== Environment Detection ==="
    
    # OS
    OS=$(uname -s)
    ARCH=$(uname -m)
    echo "OS: $OS, Arch: $ARCH"
    
    # Rosetta detection (macOS)
    if [[ "$OS" == "Darwin" ]]; then
        ROSETTA=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo "0")
        if [[ "$ROSETTA" == "1" ]]; then
            echo "WARNING: Running under Rosetta (x86_64 on ARM64)"
            echo "Use 'arch -arm64' prefix for native ARM64 execution"
            export NATIVE_PREFIX="arch -arm64 /bin/bash -c"
        else
            export NATIVE_PREFIX=""
        fi
    fi
    
    # Toolchain
    echo "Clang: $(which clang++ 2>/dev/null || echo 'NOT FOUND')"
    echo "LLDB: $(which lldb 2>/dev/null || echo 'NOT FOUND')"
    echo "GDB: $(which gdb 2>/dev/null || echo 'NOT FOUND')"
}

detect_environment
```

## Compilation Retry Strategy

```bash
compile_with_retry() {
    local src="$1"
    local out="$2"
    local compile_flags="$3"
    local link_flags="$4"
    
    echo "[Attempt 1] Standard compilation"
    if clang++ $compile_flags "$src" $link_flags -o "$out" 2>compile_err.txt; then
        echo "SUCCESS: Standard compilation"
        return 0
    fi
    cat compile_err.txt
    
    echo "[Attempt 2] Add homebrew paths"
    if clang++ $compile_flags -I/opt/homebrew/include "$src" $link_flags -L/opt/homebrew/lib -o "$out" 2>compile_err.txt; then
        echo "SUCCESS: With homebrew paths"
        return 0
    fi
    cat compile_err.txt
    
    echo "[Attempt 3] Explicit stdlib"
    if clang++ -stdlib=libc++ $compile_flags "$src" $link_flags -o "$out" 2>compile_err.txt; then
        echo "SUCCESS: With explicit stdlib"
        return 0
    fi
    cat compile_err.txt
    
    echo "[Attempt 4] Use system clang"
    if xcrun clang++ $compile_flags "$src" $link_flags -o "$out" 2>compile_err.txt; then
        echo "SUCCESS: With xcrun clang++"
        return 0
    fi
    cat compile_err.txt
    
    echo "[Attempt 5] Minimal flags"
    if clang++ -std=c++17 "$src" -lprotobuf -o "$out" 2>compile_err.txt; then
        echo "SUCCESS: Minimal flags (no ASan)"
        return 0
    fi
    
    echo "FAILED: All compilation attempts failed"
    return 1
}
```

## Debugger Retry Strategy

```bash
run_debugger() {
    local binary="$1"
    local args="$2"
    
    # On macOS under Rosetta, use arch -arm64
    if [[ -n "$NATIVE_PREFIX" ]]; then
        LLDB_CMD="$NATIVE_PREFIX 'xcrun lldb $binary -o \"run $args\" -o \"bt 30\" -o \"quit\"'"
    else
        LLDB_CMD="xcrun lldb $binary -o \"run $args\" -o \"bt 30\" -o \"quit\""
    fi
    
    echo "[Attempt 1] LLDB"
    if eval $LLDB_CMD 2>&1 | tee lldb_output.txt; then
        if ! grep -q "error:" lldb_output.txt; then
            echo "SUCCESS: LLDB worked"
            return 0
        fi
    fi
    
    echo "[Attempt 2] GDB (if available)"
    if command -v gdb &>/dev/null; then
        if [[ -n "$NATIVE_PREFIX" ]]; then
            GDB_CMD="$NATIVE_PREFIX 'gdb -batch -ex \"run $args\" -ex \"bt 30\" $binary'"
        else
            GDB_CMD="gdb -batch -ex \"run $args\" -ex \"bt 30\" $binary"
        fi
        if eval $GDB_CMD 2>&1 | tee gdb_output.txt; then
            if ! grep -q "Don't know how to run" gdb_output.txt; then
                echo "SUCCESS: GDB worked"
                return 0
            fi
        fi
    fi
    
    echo "[Attempt 3] Direct execution with crash capture"
    if timeout 60 ./$binary $args 2>&1 | tee direct_output.txt; then
        echo "Binary ran without crash"
    else
        EXIT_CODE=$?
        echo "Binary crashed with exit code: $EXIT_CODE"
        if [[ $EXIT_CODE -eq 139 ]] || [[ $EXIT_CODE -eq 134 ]]; then
            echo "SUCCESS: Crash captured (SIGSEGV or SIGABRT)"
            return 0
        fi
    fi
    
    echo "WARNING: No debugger output available, using direct execution only"
    return 1
}
```

## Build Detection and Retry

```bash
find_or_build() {
    local target="$1"
    local arch=$(uname -m)
    
    # Check standard locations
    LOCATIONS=(
        "builds/${target}-asan-${arch}"
        "builds/${target}-asan-arm64"
        "builds/${target}-asan-x86_64"
        "targets/${target}/build-audit"
        "targets/${target}/build-asan"
        "targets/${target}/build"
    )
    
    for loc in "${LOCATIONS[@]}"; do
        if [[ -f "$loc/compile_flags.txt" ]] && [[ -f "$loc/link_flags.txt" ]]; then
            echo "FOUND: Using existing build at $loc"
            export BUILD_DIR="$loc"
            return 0
        fi
    done
    
    echo "No pre-built library found. Attempting fresh build..."
    # Trigger build logic here or request build-agent
    return 1
}
```

## Error Analysis

When an operation fails, analyze the error:

| Error Pattern | Likely Cause | Solution |
|---------------|--------------|----------|
| `undefined symbol.*asan` | ASan version mismatch | Rebuild with current toolchain |
| `file not found` | Missing include/lib path | Add -I or -L flags |
| `debugserver` | Rosetta/arch mismatch | Use `arch -arm64` prefix |
| `permission denied` | Codesigning needed | Run `codesign -s - binary` |
| `library not loaded` | Missing dylib | Set DYLD_LIBRARY_PATH |

## Documentation Template

After completing task, document:

```markdown
## Execution Report

**Environment:**
- OS: [Darwin/Linux]
- Arch: [arm64/x86_64]
- Rosetta: [YES/NO]

**Attempts:**
1. [What was tried] → [Result]
2. [What was tried] → [Result]
...

**What Worked:**
- [Successful approach with exact command]

**What Failed:**
- [Failed approach]: [Error message]

**Final Status:** [SUCCESS/PARTIAL/NEEDS_MANUAL]
```

## Integration

Each agent should:
1. Start with `detect_environment`
2. Use retry functions for compilation/debugging
3. Document all attempts
4. Only report failure after ALL alternatives exhausted
