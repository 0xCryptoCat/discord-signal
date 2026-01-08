/**
 * Health Check / Status Endpoint
 * 
 * GET /api/status
 */

import { seenTokens } from '../index.js';

export default async function handler(req, res) {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    seenTokenCount: seenTokens.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
}
