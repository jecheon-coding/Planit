// Node에서 실행: npm test  (또는 node tests/run-node.js)
import { run } from './runner.js';
import './date.test.js';
import './parser.test.js';

const results = await run();
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${r.name}\n      ${r.error}`);
  }
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
