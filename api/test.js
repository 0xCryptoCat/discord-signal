/**
 * Manual Test Endpoint
 * 
 * Trigger a single poll manually for testing.
 * GET /api/test
 */

import { pollSignals, seenTokens } from '../index.js';

export default async function handler(req, res) {
  console.log(`🧪 Manual test triggered at ${new Date().toISOString()}`);
  console.log(`📊 Currently tracking ${seenTokens.size} seen tokens`);
  
  try {
    const results = await pollSignals();
    
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      signalsSent: results.filter(r => r?.sent).length,
      signalsProcessed: results.length,
      seenTokenCount: seenTokens.size,
      results: results.map(r => ({
        symbol: r?.symbol,
        address: r?.address,
        score: r?.score?.toFixed(2),
        walletCount: r?.walletCount,
        sent: r?.sent,
      })),
    });
    
  } catch (e) {
    console.error(`❌ Test error: ${e.message}`);
    return res.status(500).json({
      success: false,
      error: e.message,
      stack: e.stack,
    });
  }
}
