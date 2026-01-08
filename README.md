# Discord Signal Feed

SOL-only signal feed for Discord with high-frequency polling.

## Features

- **SOL Chain Only** - Optimized for Solana signals (chainId 501)
- **First Signal Only** - No duplicate alerts for the same token
- **Score Filter** - Only pushes signals with score 0 to +2
- **DexScreener Enrichment** - Market data from DexScreener API
- **Discord Webhook** - Direct push to Discord channel
- **Async Wallet Scoring** - Parallel wallet processing

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/poll` | GET | Main polling endpoint (cron triggered) |
| `/api/test` | GET | Manual single poll for testing |
| `/api/status` | GET | Health check and stats |
| `/api/reset` | POST | Clear seen tokens cache |

## Message Format

```
CA: <token_address>
Price: 0.000000001
MC: $123.45K
Age: 30m
Liq: $12.3K
Holders: 123

Price Change:
5m: +1.2% | 1h: -3.4% | 6h: +12.5% | 24h: +45.6%

Volume:
5m: $1.2K | 1h: $12.3K | 6h: $45.6K | 24h: $123.4K
```

## Deployment

```bash
cd discord-signal
vercel --prod
```

## Configuration

Edit `index.js` to change:
- `DISCORD_WEBHOOK` - Discord webhook URL
- `MIN_SCORE` / `MAX_SCORE` - Score filter range (default 0 to +2)
- Polling frequency in `api/poll.js`

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vercel Cron    │────▶│  OKX API        │────▶│  Wallet Scoring │
│  (1 min)        │     │  (SOL signals)  │     │  (parallel)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Discord        │◀────│  Message Build  │◀────│  DexScreener    │
│  Webhook        │     │                 │     │  (market data)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Polling Strategy

Vercel cron minimum is 1 minute. To achieve higher frequency:

1. **Multiple Polls Per Execution**: Each cron execution performs ~5 polls
2. **10-second Intervals**: Polls every 10s within the 60s window
3. **Effective Rate**: ~5 polls per minute (every 12 seconds)

For true 1-second polling, consider:
- Self-hosted solution (VPS with Node.js)
- Cloudflare Workers with Durable Objects
- AWS Lambda with Step Functions

## Environment Variables

None required - webhook URL is hardcoded for simplicity.

For production, consider using:
```
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
```

## Seen Tokens Cache

The `seenTokens` Set is in-memory and resets on cold starts.

For persistent deduplication:
- Use Vercel KV (Redis)
- Use external database
- Use Telegram channel storage (like signal-pipeline)
