/**
 * Discord Signal Poll Endpoint
 * 
 * Called by Vercel cron every minute.
 * Uses pollLoop() to run for 55 seconds with 5-second intervals.
 */

import { pollLoop, seenTokens } from '../index.js';

export const config = {
  maxDuration: 60, // Maximum execution time (Pro plan: 60s)
};

export default async function handler(req, res) {
  const startTime = Date.now();
  
  console.log(`🚀 Poll handler started at ${new Date().toISOString()}`);
  console.log(`📊 Currently tracking ${seenTokens.size} seen tokens`);
  
  try {
    // Run poll loop for 55 seconds (5s buffer for response)
    const results = await pollLoop({
      dryRun: false,
      maxDurationMs: 55000, // 55 seconds
    });
    
    const totalTime = Date.now() - startTime;
    
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      executionTimeMs: totalTime,
      signalsSent: results.filter(r => r?.sent).length,
      signalsProcessed: results.length,
      seenTokenCount: seenTokens.size,
      results: results.map(r => ({
        symbol: r?.symbol,
        score: r?.score?.toFixed(2),
        sent: r?.sent,
      })),
    });
    
  } catch (e) {
    console.error(`❌ Handler error: ${e.message}`);
    return res.status(500).json({
      success: false,
      error: e.message,
      timestamp: new Date().toISOString(),
    });
  }
}
