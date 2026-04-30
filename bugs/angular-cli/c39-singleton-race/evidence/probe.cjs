const fs = require('fs');
const trial = process.argv[2];
(async () => {
  const [r1, r2] = await Promise.all([
    fetch('http://localhost:4000/', { headers: { Authorization: 'Bearer A' } }),
    fetch('http://localhost:4000/', { headers: { Authorization: 'Bearer B' } }),
  ]);
  const [t1, t2] = await Promise.all([r1.text(), r2.text()]);
  fs.writeFileSync(`evidence/exploit_run${trial}_A.html`, t1);
  fs.writeFileSync(`evidence/exploit_run${trial}_B.html`, t2);
  const aA = t1.includes('BEARER=Bearer A'), aB = t1.includes('BEARER=Bearer B');
  const bA = t2.includes('BEARER=Bearer A'), bB = t2.includes('BEARER=Bearer B');
  const bleed = (aB && !aA) || (bA && !bB) || (aA && aB) || (bA && bB);
  console.log(`trial ${trial}: A=[hasA:${aA},hasB:${aB}] B=[hasA:${bA},hasB:${bB}]${bleed ? ' *** BLEED ***' : ''}`);
})();
