/**
 * Discord Signal Poll Endpoint
 * 
 * Called by external cron-job.org every minute.
 * Runs pollLoop() for 59 seconds with 1-second intervals.
 * State (sent CAs) is loaded from Discord channel on each cold start.
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
    // Run poll loop for 59 seconds (1s buffer for response)
    // Poll every 10 seconds to allow time for wallet scoring
    const results = await pollLoop({
      dryRun: false,
      maxDurationMs: 59000, // 59 seconds
      pollIntervalMs: 10000, // 10 seconds between polls
    });
    
    const totalTime = Date.now() - startTime;
    
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      executionTimeMs: totalTime,
      pollCount: results.pollCount,
      signalsSent: results.results.filter(r => r?.sent).length,
      signalsProcessed: results.results.length,
      seenTokenCount: seenTokens.size,
      results: results.results.map(r => ({
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
