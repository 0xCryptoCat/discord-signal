/**
 * Reset seen tokens cache
 * 
 * POST /api/reset
 */

import { seenTokens } from '../index.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const previousCount = seenTokens.size;
  seenTokens.clear();
  
  return res.status(200).json({
    success: true,
    message: 'Seen tokens cache cleared',
    previousCount,
    currentCount: seenTokens.size,
    timestamp: new Date().toISOString(),
  });
}
