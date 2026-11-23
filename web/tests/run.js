// Ejecuta los tests con Node 20+:  node web/tests/run.js
import { run } from './all.js';

const results = await run();
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name}`);
  if (!result.ok) console.log(`     ${result.error.replace(/\n/g, '\n     ')}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} tests correctos`);
process.exitCode = failed ? 1 : 0;
