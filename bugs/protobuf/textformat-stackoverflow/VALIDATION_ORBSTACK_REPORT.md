# OrbStack Protocol Buffers ASan Validation Report

- Environment: OrbStack Ubuntu VM (aarch64, Linux native)
- Date: 2026-04-15
- Working directory on Mac: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter`
- Status: Blocked before VM command execution

## Summary

All 9 requested steps were attempted from this environment.

Direct `ssh ubuntu@orb ...` access failed immediately because OrbStack's generated `ubuntu` machine rejected proxied SSH authentication and the helper deleted/recreated the machine.

Fallback attempts using the local `orb` CLI also failed in this sandbox with the same underlying OrbStack startup/auth path, so no Linux guest command completed and none of the requested VM output files were generated on the shared mount.

Separate local macOS arm64 ASan evidence already present in this repository does show an AddressSanitizer `SEGV` for the `textformat-stackoverflow` PoC, but that is not an OrbStack Ubuntu VM result and is not treated here as VM confirmation.

## Step-by-Step Log

### STEP 1 - Verify SSH and shared mount

Command:

```sh
ssh ubuntu@orb 'mkdir -p /mnt/mac && mountpoint /mnt/mac > /dev/null 2>&1 && echo MOUNTED || echo NEED_MOUNT'
```

stdout:

```text
(none)
```

stderr:

```text
panic: start VM: VM exited unexpectedly; logs:
...
📦 scon | time="04-15 10:23:08" level=info msg="container created" container=ubuntu
📦 scon | time="04-15 10:24:30" level=error msg="SSH connection failed" error="[ssh: no auth passed yet, permission denied, permission denied]"
mm_receive_fd: recvmsg: expected received 1 got 0
proxy dialer did not pass back a connection
```

Command:

```sh
ssh ubuntu@orb 'mount | grep -E "mnt|Users|carlosgomez" | head -20'
```

stdout:

```text
(none)
```

stderr:

```text
Same OrbStack startup/auth failure as above.
```

Command:

```sh
ssh ubuntu@orb 'ls /mnt/mac/ 2>/dev/null || ls /Users/ 2>/dev/null || ls / 2>/dev/null'
```

stdout:

```text
(none)
```

stderr:

```text
Same OrbStack startup/auth failure as above.
```

### STEP 2 - Discover actual mount path for Mac home directory on the VM

Command:

```sh
ssh ubuntu@orb 'find / -maxdepth 5 -name "vulnhunter" -type d 2>/dev/null | head -5'
```

stdout:

```text
(none)
```

stderr:

```text
Same OrbStack startup/auth failure as above.
```

Result:

```text
VULN_PATH could not be discovered from the VM because no guest command executed.
```

### Diagnostic fallback - local OrbStack inspection

Checked local OrbStack config:

```text
Host orb
  Hostname 127.0.0.1
  Port 32222
  User default
  IdentityFile ~/.orbstack/ssh/id_ed25519
  ProxyCommand '.../OrbStack Helper' ssh-proxy-fdpass 501
  ProxyUseFdpass yes
```

Observed `ssh -G orb` resolution:

```text
host orb
user default
hostname 127.0.0.1
port 32222
identitiesonly yes
identityfile ~/.orbstack/ssh/id_ed25519
proxyusefdpass yes
```

Observed OrbStack machine lifecycle failure:

```text
📦 scon | time="04-15 10:22:55" level=info msg="creating container" ... name=ubuntu
📦 scon | time="04-15 10:23:08" level=info msg="container created" container=ubuntu
📦 scon | time="04-15 10:24:30" level=error msg="SSH connection failed" error="[ssh: no auth passed yet, permission denied, permission denied]"
📦 scon | time="04-15 10:31:22" level=info msg="deleting container" container=ubuntu
📦 scon | time="04-15 10:31:31" level=info msg="creating container" ... name=ubuntu
📦 scon | time="04-15 10:32:08" level=info msg="container created" container=ubuntu
```

### STEP 3 - Build protobuf with ASan in VM

Requested command:

```sh
ssh ubuntu@orb "
  set -e
  cd \$VULN_PATH/targets/protobuf
  rm -rf build-linux-asan
  mkdir -p build-linux-asan
  cd build-linux-asan
  cmake .. \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_C_FLAGS='-fsanitize=address -g' \
    -DCMAKE_CXX_FLAGS='-fsanitize=address -g' \
    -DCMAKE_EXE_LINKER_FLAGS='-fsanitize=address' \
    -Dprotobuf_BUILD_TESTS=OFF
  cmake --build . -j4 2>&1 | tail -30
"
```

Result:

```text
Not executed. VULN_PATH was unavailable because STEP 1/2 failed before guest command execution.
```

Local path existence check:

```text
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf exists locally.
```

### STEP 4 - Compile ASan PoC

Requested discovery command:

```sh
ssh ubuntu@orb 'find $VULN_PATH/bugs -name "*.cpp" 2>/dev/null | head -20'
```

Result:

```text
Not executed in VM due the same OrbStack access failure.
```

Local equivalents found:

```text
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/poc_state.cpp
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc_backup_20260415_083916/poc_stack_overflow.cpp
```

Notably, a direct local `poc/poc_real.cpp` path for `textformat-stackoverflow` was not present in the current tree.

### STEP 5 - Execute ASan PoC in VM

Requested command:

```sh
ssh ubuntu@orb "
  cd $VULN_PATH/bugs/protobuf/textformat-stackoverflow/poc
  ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real_asan 2>&1 | tee asan_output_vm.txt
"
```

Result:

```text
Not executed. asan_output_vm.txt was not created.
```

### STEP 6 - Compile poc_state for GDB in VM

Requested command:

```sh
ssh ubuntu@orb "
  cd $VULN_PATH/bugs/protobuf/textformat-stackoverflow/debugging
  clang++ -I$VULN_PATH/targets/protobuf/src \
    -I$VULN_PATH/targets/protobuf/build-linux-asan \
    -g \
    poc_state.cpp \
    -L$VULN_PATH/targets/protobuf/build-linux-asan \
    -lprotobuf -lz -Wl,-rpath,$VULN_PATH/targets/protobuf/build-linux-asan \
    -o poc_state_gdb
"
```

Result:

```text
Not executed. poc_state_gdb was not built in the VM.
```

### STEP 7 - Execute control and exploit runs in VM

Requested command:

```sh
ssh ubuntu@orb "
  cd $VULN_PATH/bugs/protobuf/textformat-stackoverflow/debugging
  ./poc_state_gdb 10 2>&1 | tee control_run_vm.txt
  ./poc_state_gdb 12 2>&1 | tee exploit_run_vm.txt
"
```

Result:

```text
Not executed. control_run_vm.txt and exploit_run_vm.txt were not created.
```

### STEP 8 - Verify output files exist on Mac

Command:

```sh
ls -lh /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/asan_output_vm.txt 2>/dev/null || echo 'ASan output not found on Mac yet'
```

stdout:

```text
ASan output not found on Mac yet
```

Command:

```sh
ls -lh /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/control_run_vm.txt 2>/dev/null || echo 'Control run not found on Mac yet'
```

stdout:

```text
Control run not found on Mac yet
```

Command:

```sh
ls -lh /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/debugging/exploit_run_vm.txt 2>/dev/null || echo 'Exploit run not found on Mac yet'
```

stdout:

```text
Exploit run not found on Mac yet
```

## Full contents of `asan_output_vm.txt`

```text
File not generated. The requested VM command never executed because OrbStack guest access failed before command dispatch.
```

## Full contents of `control_run_vm.txt`

```text
File not generated. The requested VM command never executed because OrbStack guest access failed before command dispatch.
```

## Full contents of `exploit_run_vm.txt`

```text
File not generated. The requested VM command never executed because OrbStack guest access failed before command dispatch.
```

## Separate local evidence present in repository

The repository already contains a local ASan output file at:

`/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/asan_output.txt`

Its full contents are:

```text
AddressSanitizer:DEADLYSIGNAL
=================================================================
==85519==ERROR: AddressSanitizer: SEGV on unknown address 0xffffd84fd7d9d8d9 (pc 0x000104c82dc0 bp 0x00016b229830 sp 0x00016b2296a0 T0)
==85519==The signal is caused by a READ memory access.
==85519==WARNING: Can't read from symbolizer at fd 4
==85519==WARNING: atos failed to symbolize address "0x104c82dc0"
==85519==WARNING: Can't write to symbolizer at fd 4
==85519==WARNING: Can't read from symbolizer at fd 5
==85519==WARNING: atos failed to symbolize address "0x104be7244"
==85519==WARNING: Can't write to symbolizer at fd 5
==85519==WARNING: Can't read from symbolizer at fd 6
==85519==WARNING: atos failed to symbolize address "0x104bf2754"
==85519==WARNING: Can't write to symbolizer at fd 6
==85519==WARNING: Can't read from symbolizer at fd 7
==85519==WARNING: atos failed to symbolize address "0x104bd72dc"
==85519==WARNING: Can't write to symbolizer at fd 7
==85519==WARNING: Failed to use and restart external symbolizer!
    #0 0x000104c82dc0 in std::__1::pair<absl::lts_20260107::container_internal::raw_hash_set<absl::lts_20260107::container_internal::FlatHashMapPolicy<std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>>, google::protobuf::Descriptor::WellKnownType>>::iterator, bool> absl::lts_20260107::container_internal::raw_hash_set<absl::lts_20260107::container_internal::FlatHashMapPolicy<std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>>, google::protobuf::Descriptor::WellKnownType>>::find_or_prepare_insert_large<std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>>>(std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>> const&)+0x194 (/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/poc_real:arm64+0x1000aedc0)
    #1 0x000104be7244 in google::protobuf::DescriptorPool::Tables::Tables()+0x7cc (/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/poc_real:arm64+0x100013244)
    #2 0x000104bf2754 in google::protobuf::DescriptorPool::DescriptorPool()+0xb0 (/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/poc_real:arm64+0x10001e754)
    #3 0x000104bd72dc in main+0x3ec (/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/poc_real:arm64+0x1000032dc)
    #4 0x00018d643da0 in start+0x1b4c (/usr/lib/dyld:arm64e+0x1fda0)

==85519==Register values:
 x[0] = 0xbebebefebebec6ce   x[1] = 0x00006030000062b0   x[2] = 0x000000000000001a   x[3] = 0x0000603000006510  
 x[4] = 0x0000000000000002   x[5] = 0x0000000000000000   x[6] = 0x000000016aa30000   x[7] = 0x0000000000000001  
 x[8] = 0x17d7d7dfd7d7d8d9   x[9] = 0x00000c2c000001ae  x[10] = 0x2945a7d7524d215e  x[11] = 0x16800d5ac9858932  
x[12] = 0x0000604000002c18  x[13] = 0xbebebebebebebebe  x[14] = 0x000000016b229897  x[15] = 0x000000016b229888  
x[16] = 0xbebebebebebebebe  x[17] = 0x000000002d645312  x[18] = 0x0000000000000000  x[19] = 0x000000016b2296e0  
x[20] = 0x000000016b229b50  x[21] = 0x0000007000020000  x[22] = 0x0000616000000d40  x[23] = 0x0000000000000000  
x[24] = 0x0000004000000810  x[25] = 0x000000016b229880  x[26] = 0x000000702d6652d4  x[27] = 0x000000016b2296a0  
x[28] = 0x00000c2c000001ad     fp = 0x000000016b229830     lr = 0x0000000104c82d48     sp = 0x000000016b2296a0  
AddressSanitizer can not provide additional info.
SUMMARY: AddressSanitizer: SEGV (/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-stackoverflow/poc/poc_real:arm64+0x1000aedc0) in std::__1::pair<absl::lts_20260107::container_internal::raw_hash_set<absl::lts_20260107::container_internal::FlatHashMapPolicy<std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>>, google::protobuf::Descriptor::WellKnownType>>::iterator, bool> absl::lts_20260107::container_internal::raw_hash_set<absl::lts_20260107::container_internal::FlatHashMapPolicy<std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>>, google::protobuf::Descriptor::WellKnownType>>::find_or_prepare_insert_large<std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>>>(std::__1::basic_string<char, std::__1::char_traits<char>, std::__1::allocator<char>> const&)+0x194
==85519==ABORTING
```

## Conclusion

OrbStack Ubuntu VM validation is **NOT COMPLETED** from this environment because guest access failed before any requested VM command could run.

For the specific OrbStack VM artifacts requested in this task, ASan crash detection is **UNVERIFIED** because `asan_output_vm.txt` was never created.

Separate non-VM evidence already present in the repository does show an AddressSanitizer `SEGV` for the `textformat-stackoverflow` PoC on local arm64 macOS, but that is not a Linux native OrbStack validation result.
