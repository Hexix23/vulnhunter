const fetch1 = fetch('http://localhost:4000/', { headers: { Authorization: 'Bearer A' } });
const fetch2 = fetch('http://localhost:4000/', { headers: { Authorization: 'Bearer B' } });
const [r1, r2] = await Promise.all([fetch1, fetch2]);
const [t1, t2] = await Promise.all([r1.text(), r2.text()]);
require('fs').writeFileSync(process.env.OUT_A, t1);
require('fs').writeFileSync(process.env.OUT_B, t2);
console.log('A contains Bearer A:', t1.includes('Bearer A'), '| contains Bearer B:', t1.includes('Bearer B'));
console.log('B contains Bearer A:', t2.includes('Bearer A'), '| contains Bearer B:', t2.includes('Bearer B'));
