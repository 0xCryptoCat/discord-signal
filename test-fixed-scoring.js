/**
 * Test the fixed scoring logic
 */

import { pollLoop } from './index.js';

console.log('Testing fixed scoring (20s dry run)...\n');

pollLoop({ dryRun: true, maxDurationMs: 20000 })
  .then(results => {
    console.log('\n=== RESULTS ===');
    console.log('Total signals:', results.results?.length || 0);
    if (results.results?.length > 0) {
      results.results.forEach(r => {
        console.log(`  - ${r.symbol} | score: ${r.score?.toFixed(2)} | holders: ${r.holders}`);
      });
    }
  })
  .catch(console.error);
