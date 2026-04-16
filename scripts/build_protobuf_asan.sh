#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter"
TARGET_REPO="$ROOT/targets/protobuf"
BUILD_DIR="$TARGET_REPO/_codeql_build_dir"
OUTPUT_DIR="$ROOT/builds/protobuf-asan-arm64"
ARCH="arm64"
COMMIT="$(git -C "$TARGET_REPO" rev-parse --short HEAD)"
CC="$(xcrun -f clang)"
CXX="$(xcrun -f clang++)"
AR="$(xcrun -f ar)"
RANLIB="$(xcrun -f ranlib)"
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
COMMON_SAN="-fsanitize=address,undefined -g -O1 -fno-omit-frame-pointer -arch $ARCH -isysroot $SDKROOT"
COMMON_DBG="-g -O0 -fno-omit-frame-pointer -arch $ARCH -isysroot $SDKROOT"
LOG="$OUTPUT_DIR/build_error.log"

mkdir -p "$OUTPUT_DIR/lib" "$OUTPUT_DIR/bin" "$OUTPUT_DIR/include"
: > "$LOG"

if [[ ! -d "$BUILD_DIR" ]]; then
  echo "missing build dir: $BUILD_DIR" | tee -a "$LOG"
  exit 1
fi

rewrite_generated_tree() {
  local compiler_root
  compiler_root="/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/state/codeql_db/working/autobuild/bin"

  find "$BUILD_DIR" -type f \( -name build.make -o -name flags.make -o -name link.txt -o -name Makefile \) -print0 |
    xargs -0 perl -pi -e "s@\Q$compiler_root/c++\E@$CXX@g; s@\Q$compiler_root/cc\E@$CC@g; s@\Q/opt/homebrew/opt/binutils/bin/ar\E@$AR@g; s@\Q/opt/homebrew/opt/binutils/bin/ranlib\E@$RANLIB@g"
}

inject_flags() {
  local file
  export COMMON_SAN
  while IFS= read -r -d '' file; do
    perl -0pi -e '
      s/^CXX_FLAGS = .*$/CXX_FLAGS = $ENV{COMMON_SAN} -std=gnu++17 -fvisibility=hidden -fvisibility-inlines-hidden/m;
      s/^C_FLAGS = .*$/C_FLAGS = $ENV{COMMON_SAN}/m;
    ' "$file"
  done < <(find "$BUILD_DIR" -path '*/flags.make' -print0)
}

clean_previous_outputs() {
  find "$BUILD_DIR" -name '*.o' -o -name '*.o.d' -o -name '*.a' | while read -r path; do
    rm -f "$path"
  done
}

build_targets() {
  local target
  local jobs
  jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
  for target in utf8_validity/fast utf8_range/fast libprotobuf-lite/fast libprotobuf/fast libprotoc/fast libupb/fast; do
    echo "building $target" | tee -a "$LOG"
    make -C "$BUILD_DIR" -j"$jobs" "$target" >>"$LOG" 2>&1
  done
}

copy_artifacts() {
  local libs=(
    "$BUILD_DIR/libprotobuf-lite.a"
    "$BUILD_DIR/libprotobuf.a"
    "$BUILD_DIR/libprotoc.a"
    "$BUILD_DIR/libupb.a"
    "$BUILD_DIR/third_party/utf8_range/libutf8_range.a"
    "$BUILD_DIR/third_party/utf8_range/libutf8_validity.a"
  )

  rm -rf "$OUTPUT_DIR/lib" "$OUTPUT_DIR/include"
  mkdir -p "$OUTPUT_DIR/lib" "$OUTPUT_DIR/include/google" "$OUTPUT_DIR/include/upb" "$OUTPUT_DIR/include/upb_generator" "$OUTPUT_DIR/include/third_party/utf8_range"

  for lib in "${libs[@]}"; do
    [[ -f "$lib" ]] || { echo "missing built library: $lib" | tee -a "$LOG"; exit 1; }
    cp "$lib" "$OUTPUT_DIR/lib/"
  done

  cp -R "$TARGET_REPO/src/google" "$OUTPUT_DIR/include/"
  cp -R "$TARGET_REPO/upb"/* "$OUTPUT_DIR/include/upb/"
  cp -R "$TARGET_REPO/upb_generator"/* "$OUTPUT_DIR/include/upb_generator/"
  cp "$TARGET_REPO"/third_party/utf8_range/*.h "$OUTPUT_DIR/include/third_party/utf8_range/"
}

write_flag_files() {
  local abs_out
  abs_out="$OUTPUT_DIR"
  printf '%s\n' "$COMMON_SAN -I$abs_out/include -I$abs_out/include/third_party/utf8_range -I$abs_out/include/upb -I$abs_out/include/upb_generator -I$TARGET_REPO/src -I$TARGET_REPO" > "$OUTPUT_DIR/compile_flags.txt"
  printf '%s\n' "-L$abs_out/lib -lprotobuf -lprotobuf-lite -lprotoc -lupb -lutf8_range -lutf8_validity -lz -lc++ -lpthread -framework CoreFoundation -fsanitize=address,undefined" > "$OUTPUT_DIR/link_flags.txt"
  printf '%s\n' "$COMMON_DBG -I$abs_out/include -I$abs_out/include/third_party/utf8_range -I$abs_out/include/upb -I$abs_out/include/upb_generator -I$TARGET_REPO/src -I$TARGET_REPO" > "$OUTPUT_DIR/compile_flags_debug.txt"
  printf '%s\n' "-L$abs_out/lib -lprotobuf -lprotobuf-lite -lprotoc -lupb -lutf8_range -lutf8_validity -lz -lc++ -lpthread -framework CoreFoundation" > "$OUTPUT_DIR/link_flags_debug.txt"
}

write_metadata() {
  local built_at
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat > "$OUTPUT_DIR/build_info.json" <<EOF
{
  "target": "protobuf",
  "arch": "$ARCH",
  "sanitizers": ["address", "undefined"],
  "compiler": "$("$CXX" --version | head -n 1 | sed 's/\"/\\"/g')",
  "built_at": "$built_at",
  "source_commit": "$COMMIT",
  "libraries": ["libprotobuf.a", "libprotobuf-lite.a", "libprotoc.a", "libupb.a", "libutf8_range.a", "libutf8_validity.a"],
  "dependencies": {
    "zlib": "system",
    "utf8_range": "bundled",
    "abseil": "compiled into static archives"
  }
}
EOF

  cat > "$OUTPUT_DIR/README.md" <<EOF
# protobuf ASan build

Build directory: \`$OUTPUT_DIR\`

Compile example:
\`\`\`bash
\$(cat "$OUTPUT_DIR/compile_flags.txt") -c test.cc
\`\`\`

Link example:
\`\`\`bash
$CXX \$(cat "$OUTPUT_DIR/compile_flags.txt") test.cc \$(cat "$OUTPUT_DIR/link_flags.txt") -o test
\`\`\`
EOF
}

verify_smoke_test() {
  local test_src test_bin
  test_src="$OUTPUT_DIR/test_smoke.cc"
  test_bin="$OUTPUT_DIR/bin/test_smoke"
  cat > "$test_src" <<'EOF'
#include <google/protobuf/descriptor.pb.h>
#include <iostream>

int main() {
  google::protobuf::FileDescriptorSet set;
  set.add_file()->set_name("smoke.proto");
  std::cout << set.file_size() << "\n";
  return 0;
}
EOF
  "$CXX" $(cat "$OUTPUT_DIR/compile_flags.txt") "$test_src" $(cat "$OUTPUT_DIR/link_flags.txt") -o "$test_bin" >>"$LOG" 2>&1
}

rewrite_generated_tree
inject_flags
clean_previous_outputs
build_targets
copy_artifacts
write_flag_files
write_metadata
verify_smoke_test

echo "BUILD_COMPLETE: $OUTPUT_DIR"
echo "COMPILE_FLAGS: $(cat "$OUTPUT_DIR/compile_flags.txt")"
echo "LINK_FLAGS: $(cat "$OUTPUT_DIR/link_flags.txt")"
echo "LIBRARIES: $(cd "$OUTPUT_DIR/lib" && ls -1 *.a | tr '\n' ' ' | sed 's/ $//')"
