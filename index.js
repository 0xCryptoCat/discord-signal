/**
 * Discord Signal Feed - SOL Only
 * 
 * Optimized for high-frequency polling of Solana signals.
 * Pushes first-signal-only alerts to Discord webhook.
 * 
 * Features:
 * - SOL chain only (chainId 501)
 * - First signal per token only (no subsequent)
 * - Score filter: 0 to +2 only
 * - DexScreener market data enrichment
 * - Discord webhook delivery
 * - Async wallet scoring
 */

// ============================================================
// CONFIGURATION
// ============================================================

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1458574876796256318/HWCCxr5XsAd70X5jwBeC8eF40oCo563PUXDNh_XkJp2PYpnWRfftC32aJbxt2xsCbynT';
const DISCORD_CHANNEL_ID = '1458574846123573451';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || ''; // Set this for dedup via reading channel

const CHAIN_ID = 501; // Solana only
const MIN_SCORE = 0;  // Only push signals with score >= 0
const MAX_SCORE = 2;  // Up to +2

// In-memory seen tokens (reset on cold start, but we'll try to load from Discord first)
const seenTokens = new Set();
let seenTokensLoaded = false;

// ============================================================
// DISCORD BOT - Read sent CAs for deduplication
// ============================================================

/**
 * Load already-sent CAs from Discord channel messages
 * Requires DISCORD_BOT_TOKEN env var AND "MESSAGE CONTENT INTENT" enabled in Discord Developer Portal
 */
async function loadSeenTokensFromDiscord() {
  if (seenTokensLoaded) return;
  if (!DISCORD_BOT_TOKEN) {
    console.log('⚠️ No DISCORD_BOT_TOKEN - using in-memory dedup only');
    seenTokensLoaded = true;
    return;
  }
  
  try {
    console.log('📖 Loading sent CAs from Discord channel...');
    
    // Fetch last 100 messages from channel
    // Note: Requires MESSAGE CONTENT INTENT enabled in Discord Developer Portal
    const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=100`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      },
    });
    
    if (!res.ok) {
      console.error(`Discord API error: ${res.status}`);
      seenTokensLoaded = true;
      return;
    }
    
    const messages = await res.json();
    
    // Extract CAs from messages (format: "**CA:** `<address>`")
    // Also check embeds in case webhook uses embed format
    const caRegex = /\*\*CA:\*\*\s*`([A-Za-z0-9]+)`/;
    const plainCaRegex = /`([A-HJ-NP-Za-km-z1-9]{32,44})`/; // Solana address pattern
    
    for (const msg of messages) {
      // Try main content first
      let match = msg.content?.match(caRegex);
      if (match && match[1]) {
        seenTokens.add(match[1]);
        continue;
      }
      
      // Try plain CA pattern in content
      match = msg.content?.match(plainCaRegex);
      if (match && match[1]) {
        seenTokens.add(match[1]);
        continue;
      }
      
      // Check embeds (webhook messages may use embeds)
      if (msg.embeds?.length > 0) {
        for (const embed of msg.embeds) {
          const embedText = [embed.title, embed.description, ...(embed.fields?.map(f => f.value) || [])].join(' ');
          match = embedText?.match(caRegex) || embedText?.match(plainCaRegex);
          if (match && match[1]) {
            seenTokens.add(match[1]);
            break;
          }
        }
      }
    }
    
    if (seenTokens.size > 0) {
      console.log(`✅ Loaded ${seenTokens.size} CAs from Discord`);
    } else {
      console.log(`⚠️ No CAs found in Discord. Make sure MESSAGE CONTENT INTENT is enabled!`);
    }
    seenTokensLoaded = true;
    
  } catch (e) {
    console.error(`Failed to load from Discord: ${e.message}`);
    seenTokensLoaded = true;
  }
}

// ============================================================
// OKX API
// ============================================================

const ENDPOINTS = {
  filterActivity: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview',
  signalDetail: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail',
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
  candles: 'https://web3.okx.com/priapi/v5/dex/token/market/dex-token-hlc-candles',
};

const LOOKBACK_MS = 8 * 60 * 60 * 1000;  // 8 hours
const LOOKFORWARD_MS = 24 * 60 * 60 * 1000; // 24 hours

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch latest SOL signals from OKX
 */
async function fetchSolSignals(pageSize = 15) {
  const t = Date.now();
  const url = `${ENDPOINTS.filterActivity}?t=${t}`;
  
  const body = {
    chainId: CHAIN_ID,
    trend: '1', // Buys only
    signalLabelList: [1, 2, 3], // Smart Money, Influencers, Whales
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.code !== 0) throw new Error(`OKX API Error: ${json.error_message || json.msg}`);
  return json.data;
}

/**
 * Fetch signal detail (wallet breakdown)
 */
async function fetchSignalDetail(tokenAddress, batchId, batchIndex) {
  const t = Date.now();
  const url = `${ENDPOINTS.signalDetail}?chainId=${CHAIN_ID}&tokenContractAddress=${tokenAddress}&batchId=${batchId}&batchIndex=${batchIndex}&t=${t}`;
  
  const json = await fetchJson(url);
  if (json.code !== 0) throw new Error(`Signal Detail Error: ${json.error_message || json.msg}`);
  return json.data;
}

/**
 * Fetch trading history for a wallet
 */
async function fetchTradingHistory(walletAddress, limit = 30) {
  // sortType=1 sorts by time (most recent first), sortType=2 sorts by PnL
  const url = `${ENDPOINTS.tradingHistory}?walletAddress=${walletAddress}&chainId=${CHAIN_ID}&isAsc=false&sortType=1&offset=0&limit=${limit}&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== 0) return [];
    return data.data?.tokenList || [];
  } catch {
    return [];
  }
}

/**
 * Fetch OHLC candles for a token
 */
async function fetchCandles(tokenAddress, limit = 300, bar = '15m') {
  const url = `${ENDPOINTS.candles}?chainId=${CHAIN_ID}&address=${tokenAddress}&bar=${bar}&limit=${limit}&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== '0' && data.code !== 0) return [];
    
    return (data.data || []).map(c => ({
      timestamp: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
  } catch {
    return [];
  }
}

// ============================================================
// DEXSCREENER API
// ============================================================

/**
 * Fetch token market data from DexScreener
 */
async function fetchDexScreenerData(tokenAddress) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    
    // Get the main pair (highest liquidity)
    const pairs = data.pairs.filter(p => p.chainId === 'solana');
    if (pairs.length === 0) return null;
    
    const mainPair = pairs.sort((a, b) => 
      (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0)
    )[0];
    
    return {
      price: parseFloat(mainPair.priceUsd) || 0,
      priceNative: parseFloat(mainPair.priceNative) || 0,
      mcap: mainPair.marketCap || mainPair.fdv || 0,
      liquidity: parseFloat(mainPair.liquidity?.usd) || 0,
      
      // Price changes
      priceChange: {
        m5: mainPair.priceChange?.m5 || 0,
        h1: mainPair.priceChange?.h1 || 0,
        h6: mainPair.priceChange?.h6 || 0,
        h24: mainPair.priceChange?.h24 || 0,
      },
      
      // Volume
      volume: {
        m5: mainPair.volume?.m5 || 0,
        h1: mainPair.volume?.h1 || 0,
        h6: mainPair.volume?.h6 || 0,
        h24: mainPair.volume?.h24 || 0,
      },
      
      // Token info
      symbol: mainPair.baseToken?.symbol || '???',
      name: mainPair.baseToken?.name || 'Unknown',
      pairAddress: mainPair.pairAddress,
      dexId: mainPair.dexId,
      
      // Age (from pair creation)
      pairCreatedAt: mainPair.pairCreatedAt,
      
      // Txns
      txns: mainPair.txns || {},
      
      // Info links
      info: mainPair.info || {},
    };
  } catch (e) {
    console.error(`DexScreener error for ${tokenAddress}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch holder count from Solscan or fallback
 */
async function fetchHolderCount(tokenAddress) {
  // Using Helius or other API would be better, but for now return from OKX data
  // This is a placeholder - you can integrate Helius API here
  return null;
}

// ============================================================
// SCORING LOGIC (Same as signal-pipeline)
// ============================================================

function classifyBefore(entryPrice, beforeMin, beforeMax) {
  const riseToEntry = ((entryPrice - beforeMin) / beforeMin) * 100;
  const fallToEntry = ((beforeMax - entryPrice) / beforeMax) * 100;
  
  if (riseToEntry > 25 && riseToEntry > fallToEntry) return 'pumped_to';
  if (riseToEntry > 10 && riseToEntry > fallToEntry) return 'rose_to';
  if (fallToEntry > 25 && fallToEntry > riseToEntry) return 'dumped_to';
  if (fallToEntry > 10 && fallToEntry > riseToEntry) return 'fell_to';
  return 'flat';
}

function classifyAfter(entryPrice, afterMin, afterMax) {
  const pctUp = ((afterMax - entryPrice) / entryPrice) * 100;
  const pctDown = ((entryPrice - afterMin) / entryPrice) * 100;
  
  if (pctUp > 25 && pctUp > pctDown) return 'moon';
  if (pctUp > 10 && pctUp > pctDown) return 'pump';
  if (pctDown > 25 && pctDown > pctUp) return 'dump';
  if (pctDown > 10 && pctDown > pctUp) return 'dip';
  return 'flat';
}

function scoreBuy(beforeCtx, afterCtx) {
  const matrix = {
    'dumped_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'fell_to': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'flat': { 'moon': 2, 'pump': 1, 'flat': 0, 'dip': -1, 'dump': -2 },
    'rose_to': { 'moon': 1, 'pump': 0, 'flat': -1, 'dip': -2, 'dump': -2 },
    'pumped_to': { 'moon': 0, 'pump': -1, 'flat': -1, 'dip': -2, 'dump': -2 },
  };
  return matrix[beforeCtx]?.[afterCtx] ?? 0;
}

function scoreEntry(entryPrice, entryTime, candles) {
  const beforeCandles = candles.filter(c => 
    c.timestamp < entryTime && c.timestamp >= entryTime - LOOKBACK_MS
  );
  const afterCandles = candles.filter(c => 
    c.timestamp > entryTime && c.timestamp <= entryTime + LOOKFORWARD_MS
  );
  
  const beforeMin = beforeCandles.length > 0 ? Math.min(...beforeCandles.map(c => c.low)) : entryPrice;
  const beforeMax = beforeCandles.length > 0 ? Math.max(...beforeCandles.map(c => c.high)) : entryPrice;
  const afterMin = afterCandles.length > 0 ? Math.min(...afterCandles.map(c => c.low)) : entryPrice;
  const afterMax = afterCandles.length > 0 ? Math.max(...afterCandles.map(c => c.high)) : entryPrice;
  
  const beforeCtx = classifyBefore(entryPrice, beforeMin, beforeMax);
  const afterCtx = classifyAfter(entryPrice, afterMin, afterMax);
  
  return scoreBuy(beforeCtx, afterCtx);
}

/**
 * Score a wallet's entry quality (7d tokens only)
 */
async function scoreWalletEntries(walletAddress, maxTokens = 10) {
  const tokens = await fetchTradingHistory(walletAddress, maxTokens);
  
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentTokens = tokens.filter(t => 
    t.latestTime && parseInt(t.latestTime, 10) >= sevenDaysAgo
  );
  
  if (recentTokens.length === 0) return { avgScore: 0, count: 0 };
  
  const scores = [];
  
  for (const token of recentTokens.slice(0, 6)) {
    const tokenAddress = token.tokenContractAddress;
    const buyAvgPrice = parseFloat(token.buyAvgPrice) || 0;
    const buyCount = token.totalTxBuy || 0;
    
    if (buyCount > 0 && buyAvgPrice > 0) {
      const candles = await fetchCandles(tokenAddress);
      
      if (candles.length > 0) {
        const closestCandle = candles.reduce((best, c) => 
          Math.abs(c.close - buyAvgPrice) < Math.abs(best.close - buyAvgPrice) ? c : best
        );
        const score = scoreEntry(buyAvgPrice, closestCandle.timestamp, candles);
        for (let i = 0; i < Math.min(buyCount, 3); i++) {
          scores.push(score);
        }
      }
    }
    
    await sleep(20);
  }
  
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return { avgScore, count: scores.length };
}

// ============================================================
// DISCORD FORMATTING
// ============================================================

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '???';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  if (num >= 1) return `$${num.toFixed(2)}`;
  return `$${num.toFixed(6)}`;
}

function formatPrice(price) {
  if (!price || price === 0) return '???';
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  if (price >= 0.00000001) return price.toFixed(10);
  return price.toExponential(4);
}

function formatPct(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return '0%';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function formatAge(timestamp) {
  if (!timestamp) return '???';
  const ageMs = Date.now() - timestamp;
  const mins = ageMs / (1000 * 60);
  const hours = mins / 60;
  const days = hours / 24;
  
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  if (days < 7) return `${days.toFixed(1)}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * Build Discord message content
 */
function buildDiscordMessage(tokenAddress, dexData, holders) {
  const lines = [
    `**CA:** \`${tokenAddress}\``,
    `**Price:** ${formatPrice(dexData.price)}`,
    `**MC:** ${formatNumber(dexData.mcap)}`,
    `**Age:** ${formatAge(dexData.pairCreatedAt)}`,
    `**Liq:** ${formatNumber(dexData.liquidity)}`,
    `**Holders:** ${holders || '???'}`,
    '',
    '**Price Change:**',
    `\`5m: ${formatPct(dexData.priceChange.m5)} | 1h: ${formatPct(dexData.priceChange.h1)} | 6h: ${formatPct(dexData.priceChange.h6)} | 24h: ${formatPct(dexData.priceChange.h24)}\``,
    '',
    '**Volume:**',
    `\`5m: ${formatNumber(dexData.volume.m5)} | 1h: ${formatNumber(dexData.volume.h1)} | 6h: ${formatNumber(dexData.volume.h6)} | 24h: ${formatNumber(dexData.volume.h24)}\``,
  ];
  
  return lines.join('\n');
}

/**
 * Send message to Discord webhook
 */
async function sendToDiscord(content, tokenSymbol) {
  const payload = {
    content: content,
    username: `Alphalert | ${tokenSymbol}`,
    avatar_url: 'https://i.imgur.com/4M34hi2.png', // Placeholder avatar
  };
  
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) {
      const text = await res.text();
      console.error(`Discord webhook error: ${res.status} - ${text}`);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error(`Discord send error: ${e.message}`);
    return false;
  }
}

// ============================================================
// MAIN SIGNAL PROCESSOR
// ============================================================

/**
 * Main polling function
 * @param {Object} options
 * @param {boolean} options.dryRun - If true, don't send to Discord
 */
export async function pollSignals(options = {}) {
  const { dryRun = false } = options;
  
  console.log(`\n🚀 Polling SOL signals at ${new Date().toISOString()}${dryRun ? ' [DRY RUN]' : ''}`);
  
  // Load seen tokens from Discord on first run
  if (!dryRun) {
    await loadSeenTokensFromDiscord();
  }
  
  try {
    // Fetch latest signals
    const data = await fetchSolSignals(15);
    const activities = data.activityList || [];
    const tokenInfoMap = data.tokenInfo || {};
    
    console.log(`📥 Received ${activities.length} activities`);
    
    const results = [];
    
    for (const activity of activities) {
      const tokenKey = activity.tokenKey;
      const parts = tokenKey.split('!@#');
      const tokenAddress = parts[1];
      
      // Quick skip if already seen
      if (seenTokens.has(tokenAddress)) continue;
      
      const tokenInfo = tokenInfoMap[tokenKey] || {};
      const result = await processSignalWithOptions(activity, tokenInfo, { dryRun });
      
      if (result) {
        results.push(result);
      }
      
      // Rate limiting
      await sleep(100);
    }
    
    console.log(`\n✅ Processed ${results.length} new signals`);
    console.log(`📊 Seen tokens: ${seenTokens.size}`);
    
    return results;
    
  } catch (e) {
    console.error(`❌ Poll error: ${e.message}`);
    return [];
  }
}

/**
 * Process signal with dry-run support
 */
async function processSignalWithOptions(activity, tokenInfo, options = {}) {
  const { dryRun = false } = options;
  const tokenKey = activity.tokenKey;
  const parts = tokenKey.split('!@#');
  const tokenAddress = parts[1];
  
  // Skip if already seen (first signal only)
  if (seenTokens.has(tokenAddress)) {
    return null;
  }
  
  console.log(`\n📊 Processing: ${tokenInfo.tokenSymbol || '???'} (${tokenAddress.slice(0, 8)}...)`);
  
  try {
    // 1. Fetch signal detail (wallet breakdown)
    const detail = await fetchSignalDetail(tokenAddress, activity.batchId, activity.batchIndex);
    const wallets = detail?.addresses || [];
    
    if (wallets.length === 0) {
      console.log(`   ⚠️ No wallets in signal`);
      return null;
    }
    
    console.log(`   👛 ${wallets.length} wallets in signal`);
    
    // 2. Score wallets using trading history
    const scoringPromises = wallets.slice(0, 8).map(async (w) => {
      const walletAddr = w.walletAddress || w.address;
      const result = await scoreWalletEntries(walletAddr);
      return { address: walletAddr, ...result };
    });
    
    const scoredWallets = await Promise.all(scoringPromises);
    
    // 3. Calculate average score from ALL wallets that were scored
    //    Include wallets with count > 0 (they have valid trading history scores)
    //    Wallets with count=0 have no trading history data, skip them
    const walletsWithData = scoredWallets.filter(w => w.count > 0);
    
    // If no wallets have trading data, we can't score this signal
    if (walletsWithData.length === 0) {
      console.log(`   ⚠️ No wallet trading history available, skipping`);
      return null;
    }
    
    // Average of ALL wallet scores (including negative scores!)
    const avgScore = walletsWithData.reduce((sum, w) => sum + w.avgScore, 0) / walletsWithData.length;
    
    console.log(`   📈 Avg Score: ${avgScore.toFixed(2)} (${walletsWithData.length}/${scoredWallets.length} wallets scored)`);
    
    // 4. Filter by score (0 to +2 only) - use small epsilon for float comparison
    if (avgScore < MIN_SCORE - 0.01 || avgScore > MAX_SCORE + 0.01) {
      console.log(`   ❌ Score ${avgScore.toFixed(2)} outside range [${MIN_SCORE}, ${MAX_SCORE}]`);
      return null;
    }
    
    // 5. Fetch DexScreener data
    const dexData = await fetchDexScreenerData(tokenAddress);
    if (!dexData) {
      console.log(`   ⚠️ No DexScreener data`);
      return null;
    }
    
    // 6. Get holder count from OKX tokenInfo
    const holders = tokenInfo.currentHolders || null;
    
    // 7. Mark as seen
    seenTokens.add(tokenAddress);
    
    // 8. Build Discord message
    const message = buildDiscordMessage(tokenAddress, dexData, holders);
    
    // 9. Send or dry-run
    let sent = false;
    if (dryRun) {
      console.log(`   📝 [DRY RUN] Would send:`);
      console.log('   ' + message.split('\n').join('\n   '));
      sent = true; // Mark as "sent" for results
    } else {
      sent = await sendToDiscord(message, dexData.symbol);
      if (sent) {
        console.log(`   ✅ Sent to Discord: ${dexData.symbol}`);
      } else {
        console.log(`   ❌ Failed to send to Discord`);
      }
    }
    
    return {
      address: tokenAddress,
      symbol: dexData.symbol,
      score: avgScore,
      walletCount: wallets.length,
      holders,
      sent,
    };
    
  } catch (e) {
    console.error(`   ❌ Error: ${e.message}`);
    return null;
  }
}

/**
 * Continuous polling loop for 59 seconds
 * Call this from the API handler
 */
export async function pollLoop(options = {}) {
  const { 
    dryRun = false, 
    maxDurationMs = 59000,  // 59 seconds (leave 1s buffer for response)
    pollIntervalMs = 1000,  // Poll every 1 second for fastest signal detection
  } = options;
  
  const startTime = Date.now();
  const allResults = [];
  let pollCount = 0;
  
  console.log(`\n🔄 Starting poll loop (${maxDurationMs / 1000}s max, ${pollIntervalMs / 1000}s interval)`);
  
  // Load seen tokens from Discord once at start
  if (!dryRun) {
    await loadSeenTokensFromDiscord();
  }
  
  while (true) {
    const elapsed = Date.now() - startTime;
    
    // Check if we should stop
    if (elapsed >= maxDurationMs) {
      console.log(`\n⏱️ Time limit reached after ${pollCount} polls`);
      break;
    }
    
    pollCount++;
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 Poll #${pollCount} (${(elapsed / 1000).toFixed(1)}s elapsed)`);
    
    const results = await pollSignals({ dryRun });
    allResults.push(...results);
    
    // Calculate time to next poll
    const pollDuration = Date.now() - startTime - elapsed;
    const waitTime = Math.max(0, pollIntervalMs - pollDuration);
    
    // Check if we have time for another poll
    if (elapsed + pollDuration + pollIntervalMs >= maxDurationMs) {
      console.log(`\n⏱️ Not enough time for another poll, stopping`);
      break;
    }
    
    if (waitTime > 0) {
      console.log(`⏳ Waiting ${(waitTime / 1000).toFixed(1)}s before next poll...`);
      await sleep(waitTime);
    }
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Poll loop complete: ${pollCount} polls, ${allResults.length} signals sent`);
  console.log(`📊 Seen tokens: ${seenTokens.size}`);
  
  return {
    pollCount,
    results: allResults,
    duration: Date.now() - startTime,
  };
}

// Export for API handler
export { seenTokens, fetchDexScreenerData, sendToDiscord, loadSeenTokensFromDiscord };
