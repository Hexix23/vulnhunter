#!/bin/bash
# Build ALL protobuf language runtimes with ASan
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/targets/protobuf"
EXISTING="$ROOT/builds/protobuf-asan-arm64"
CC="xcrun clang"
CFLAGS="-fsanitize=address -g -O1 -fPIC"
CFLAGS_DEBUG="-g -O0 -fPIC"

echo "=== Building ALL protobuf runtimes with ASan ==="
echo "Root: $ROOT"
echo "Target: $TARGET"
echo ""

# Helper: create output dirs and flag files
setup_build() {
    local name="$1"
    local dir="$ROOT/builds/$name"
    mkdir -p "$dir/lib"
    echo "$dir"
}

write_flags() {
    local dir="$1"
    local includes="$2"
    local libs="$3"
    echo "-fsanitize=address -g -O1 $includes" > "$dir/compile_flags.txt"
    echo "-fsanitize=address $libs" > "$dir/link_flags.txt"
    echo "-g -O0 $includes" > "$dir/compile_flags_debug.txt"
    echo "$libs" | sed 's/-fsanitize=address[,a-z]*//g' > "$dir/link_flags_debug.txt"
}

# ============================================================
# 1. Python C extension
# ============================================================
echo "=== [1/5] Python C extension ==="
PYTHON_INC=$(python3 -c 'import sysconfig; print(sysconfig.get_path("include"))' 2>/dev/null)
if [[ -d "$PYTHON_INC" ]]; then
    BUILD_DIR=$(setup_build "protobuf-python-asan-arm64")
    TMPDIR=$(mktemp -d)

    for src in "$TARGET"/python/*.c; do
        echo "  Compiling $(basename $src)..."
        $CC $CFLAGS \
            -I"$TARGET" -I"$TARGET/upb" -I"$EXISTING/include" -I"$PYTHON_INC" \
            -c "$src" -o "$TMPDIR/$(basename $src .c).o" 2>&1 || echo "  WARN: $(basename $src) failed"
    done

    ar rcs "$BUILD_DIR/lib/libprotobuf_python.a" "$TMPDIR"/*.o 2>/dev/null
    rm -rf "$TMPDIR"

    write_flags "$BUILD_DIR" \
        "-I$TARGET -I$TARGET/upb -I$EXISTING/include -I$PYTHON_INC" \
        "-L$BUILD_DIR/lib -lprotobuf_python -L$EXISTING/lib -lupbd.a"

    echo "  OK: $BUILD_DIR/lib/libprotobuf_python.a"
else
    echo "  SKIP: Python headers not found"
fi

# ============================================================
# 2. Objective-C
# ============================================================
echo ""
echo "=== [2/5] Objective-C ==="
BUILD_DIR=$(setup_build "protobuf-objc-asan-arm64")
TMPDIR=$(mktemp -d)

for src in "$TARGET"/objectivec/GPB*.m; do
    echo "  Compiling $(basename $src)..."
    $CC $CFLAGS -fobjc-arc \
        -I"$TARGET/objectivec" -I"$TARGET" \
        -c "$src" -o "$TMPDIR/$(basename $src .m).o" 2>&1 || echo "  WARN: $(basename $src) failed"
done

ar rcs "$BUILD_DIR/lib/libProtocolBuffers.a" "$TMPDIR"/*.o 2>/dev/null
rm -rf "$TMPDIR"

write_flags "$BUILD_DIR" \
    "-fobjc-arc -I$TARGET/objectivec -I$TARGET" \
    "-L$BUILD_DIR/lib -lProtocolBuffers -framework Foundation"

echo "  OK: $BUILD_DIR/lib/libProtocolBuffers.a"

# ============================================================
# 3. Ruby C extension
# ============================================================
echo ""
echo "=== [3/5] Ruby C extension ==="
RUBY_INC=$(ruby -e 'puts RbConfig::CONFIG["rubyhdrdir"]' 2>/dev/null)
RUBY_ARCH_INC=$(ruby -e 'puts RbConfig::CONFIG["rubyarchhdrdir"]' 2>/dev/null)
if [[ -d "$RUBY_INC" ]]; then
    BUILD_DIR=$(setup_build "protobuf-ruby-asan-arm64")
    TMPDIR=$(mktemp -d)

    for src in "$TARGET"/ruby/ext/google/protobuf_c/*.c; do
        echo "  Compiling $(basename $src)..."
        $CC $CFLAGS \
            -I"$TARGET" -I"$TARGET/upb" -I"$EXISTING/include" \
            -I"$RUBY_INC" -I"$RUBY_ARCH_INC" \
            -c "$src" -o "$TMPDIR/$(basename $src .c).o" 2>&1 || echo "  WARN: $(basename $src) failed"
    done

    ar rcs "$BUILD_DIR/lib/libprotobuf_ruby.a" "$TMPDIR"/*.o 2>/dev/null
    rm -rf "$TMPDIR"

    write_flags "$BUILD_DIR" \
        "-I$TARGET -I$TARGET/upb -I$EXISTING/include -I$RUBY_INC -I$RUBY_ARCH_INC" \
        "-L$BUILD_DIR/lib -lprotobuf_ruby -L$EXISTING/lib -lupbd.a"

    echo "  OK: $BUILD_DIR/lib/libprotobuf_ruby.a"
else
    echo "  SKIP: Ruby headers not found"
fi

# ============================================================
# 4. PHP C extension
# ============================================================
echo ""
echo "=== [4/5] PHP C extension ==="
PHP_INC=$(php-config --includes 2>/dev/null)
if [[ -n "$PHP_INC" ]]; then
    BUILD_DIR=$(setup_build "protobuf-php-asan-arm64")
    TMPDIR=$(mktemp -d)

    for src in "$TARGET"/php/ext/google/protobuf/*.c; do
        echo "  Compiling $(basename $src)..."
        $CC $CFLAGS \
            -I"$TARGET" -I"$TARGET/upb" -I"$EXISTING/include" \
            $PHP_INC \
            -c "$src" -o "$TMPDIR/$(basename $src .c).o" 2>&1 || echo "  WARN: $(basename $src) failed"
    done

    ar rcs "$BUILD_DIR/lib/libprotobuf_php.a" "$TMPDIR"/*.o 2>/dev/null
    rm -rf "$TMPDIR"

    write_flags "$BUILD_DIR" \
        "-I$TARGET -I$TARGET/upb -I$EXISTING/include $PHP_INC" \
        "-L$BUILD_DIR/lib -lprotobuf_php -L$EXISTING/lib -lupbd.a"

    echo "  OK: $BUILD_DIR/lib/libprotobuf_php.a"
else
    echo "  SKIP: PHP headers not found (install php-dev)"
fi

# ============================================================
# 5. Lua
# ============================================================
echo ""
echo "=== [5/5] Lua ==="
LUA_INC=""
[[ -d "/opt/homebrew/include/lua" ]] && LUA_INC="/opt/homebrew/include/lua"
[[ -d "/opt/homebrew/include/lua5.4" ]] && LUA_INC="/opt/homebrew/include/lua5.4"
[[ -d "/opt/homebrew/include" ]] && [[ -f "/opt/homebrew/include/lua.h" ]] && LUA_INC="/opt/homebrew/include"

if [[ -n "$LUA_INC" ]]; then
    BUILD_DIR=$(setup_build "protobuf-lua-asan-arm64")
    TMPDIR=$(mktemp -d)

    for src in "$TARGET"/lua/*.c; do
        echo "  Compiling $(basename $src)..."
        $CC $CFLAGS \
            -I"$TARGET" -I"$TARGET/upb" -I"$EXISTING/include" \
            -I"$LUA_INC" \
            -c "$src" -o "$TMPDIR/$(basename $src .c).o" 2>&1 || echo "  WARN: $(basename $src) failed"
    done

    ar rcs "$BUILD_DIR/lib/libprotobuf_lua.a" "$TMPDIR"/*.o 2>/dev/null
    rm -rf "$TMPDIR"

    write_flags "$BUILD_DIR" \
        "-I$TARGET -I$TARGET/upb -I$EXISTING/include -I$LUA_INC" \
        "-L$BUILD_DIR/lib -lprotobuf_lua -L$EXISTING/lib -lupbd.a"

    echo "  OK: $BUILD_DIR/lib/libprotobuf_lua.a"
else
    echo "  SKIP: Lua headers not found (brew install lua)"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "=== BUILD SUMMARY ==="
for d in "$ROOT"/builds/protobuf-*-asan-arm64; do
    if [[ -d "$d/lib" ]]; then
        local_size=$(du -sh "$d" | cut -f1)
        local_libs=$(ls "$d/lib"/*.a 2>/dev/null | wc -l | tr -d ' ')
        echo "  $(basename $d): ${local_libs} libs, ${local_size}"
    fi
done
echo ""
echo "Total builds disk:"
du -sh "$ROOT/builds/"
