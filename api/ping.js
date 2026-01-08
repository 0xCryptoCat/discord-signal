/**
 * Simple ping endpoint to verify deployment works
 * GET /api/ping
 */

export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    message: 'pong',
    timestamp: new Date().toISOString(),
  });
}
