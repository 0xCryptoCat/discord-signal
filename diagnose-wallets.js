/**
 * Diagnose wallet scoring issues
 * 
 * Find out why some wallets can't be scored (return count: 0)
 */

const CHAIN_ID = 501;
const LOOKBACK_MS = 8 * 60 * 60 * 1000;
const LOOKFORWARD_MS = 24 * 60 * 60 * 1000;

const ENDPOINTS = {
  filterActivity: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview',
  signalDetail: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail',
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
  candles: 'https://web3.okx.com/priapi/v5/dex/token/market/dex-token-hlc-candles',
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchSolSignals(pageSize = 15) {
  const t = Date.now();
  const url = `${ENDPOINTS.filterActivity}?t=${t}`;
  
  const body = {
    chainId: CHAIN_ID,
    trend: '1',
    signalLabelList: [1, 2, 3],
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
  return json.data;
}

async function fetchSignalDetail(tokenAddress, batchId, batchIndex) {
  const t = Date.now();
  const url = `${ENDPOINTS.signalDetail}?chainId=${CHAIN_ID}&tokenContractAddress=${tokenAddress}&batchId=${batchId}&batchIndex=${batchIndex}&t=${t}`;
  const json = await fetchJson(url);
  return json.data;
}

async function fetchTradingHistory(walletAddress, limit = 15) {
  const url = `${ENDPOINTS.tradingHistory}?walletAddress=${walletAddress}&chainId=${CHAIN_ID}&isAsc=false&sortType=2&offset=0&limit=${limit}&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== 0) {
      console.log(`      ⚠️ Trading history API error: code=${data.code}, msg=${data.msg}`);
      return { tokens: [], raw: data };
    }
    return { tokens: data.data?.tokenList || [], raw: data };
  } catch (e) {
    console.log(`      ⚠️ Trading history fetch error: ${e.message}`);
    return { tokens: [], raw: null };
  }
}

async function fetchCandles(tokenAddress, limit = 300, bar = '15m') {
  const url = `${ENDPOINTS.candles}?chainId=${CHAIN_ID}&address=${tokenAddress}&bar=${bar}&limit=${limit}&t=${Date.now()}`;
  
  try {
    const data = await fetchJson(url);
    if (data.code !== '0' && data.code !== 0) {
      return { candles: [], raw: data };
    }
    
    return {
      candles: (data.data || []).map(c => ({
        timestamp: parseInt(c[0], 10),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
      })),
      raw: data
    };
  } catch (e) {
    return { candles: [], raw: null };
  }
}

async function diagnoseWallet(walletAddress) {
  console.log(`\n🔍 Diagnosing wallet: ${walletAddress}`);
  
  // Step 1: Fetch trading history
  const { tokens, raw } = await fetchTradingHistory(walletAddress, 15);
  
  console.log(`   📊 Trading history: ${tokens.length} tokens`);
  
  if (tokens.length === 0) {
    console.log(`   ❌ ISSUE: No tokens in trading history`);
    console.log(`   📋 Raw response:`, JSON.stringify(raw, null, 2).slice(0, 500));
    return { issue: 'no_tokens', scored: 0 };
  }
  
  // Step 2: Filter by 7 days
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentTokens = tokens.filter(t => {
    const latestTime = parseInt(t.latestTime, 10);
    return latestTime >= sevenDaysAgo;
  });
  
  console.log(`   📅 Recent tokens (7d): ${recentTokens.length}`);
  
  if (recentTokens.length === 0) {
    console.log(`   ❌ ISSUE: No tokens traded in last 7 days`);
    console.log(`   📋 Token dates:`);
    tokens.slice(0, 3).forEach(t => {
      const latestTime = parseInt(t.latestTime, 10);
      const daysAgo = (now - latestTime) / (1000 * 60 * 60 * 24);
      console.log(`      - ${t.tokenSymbol}: ${daysAgo.toFixed(1)} days ago`);
    });
    return { issue: 'no_recent_tokens', scored: 0 };
  }
  
  // Step 3: Try to score each token
  let scored = 0;
  let issues = [];
  
  for (const token of recentTokens.slice(0, 4)) {
    const tokenAddress = token.tokenContractAddress;
    const buyAvgPrice = parseFloat(token.buyAvgPrice) || 0;
    const buyCount = token.totalTxBuy || 0;
    
    console.log(`\n   🪙 Token: ${token.tokenSymbol} (${tokenAddress.slice(0,8)}...)`);
    console.log(`      buyAvgPrice: ${buyAvgPrice}`);
    console.log(`      buyCount: ${buyCount}`);
    
    if (buyCount === 0) {
      console.log(`      ❌ ISSUE: buyCount is 0`);
      issues.push('buyCount_zero');
      continue;
    }
    
    if (buyAvgPrice === 0) {
      console.log(`      ❌ ISSUE: buyAvgPrice is 0`);
      issues.push('buyAvgPrice_zero');
      continue;
    }
    
    // Fetch candles
    const { candles, raw: candleRaw } = await fetchCandles(tokenAddress);
    console.log(`      📈 Candles: ${candles.length}`);
    
    if (candles.length === 0) {
      console.log(`      ❌ ISSUE: No candles available`);
      console.log(`      📋 Candle response:`, JSON.stringify(candleRaw, null, 2).slice(0, 300));
      issues.push('no_candles');
      continue;
    }
    
    // Find closest candle to buy price
    const closestCandle = candles.reduce((best, c) => 
      Math.abs(c.close - buyAvgPrice) < Math.abs(best.close - buyAvgPrice) ? c : best
    );
    
    console.log(`      🕐 Closest candle: ts=${closestCandle.timestamp}, close=${closestCandle.close}`);
    
    // Check before/after candles
    const beforeCandles = candles.filter(c => 
      c.timestamp < closestCandle.timestamp && c.timestamp >= closestCandle.timestamp - LOOKBACK_MS
    );
    const afterCandles = candles.filter(c => 
      c.timestamp > closestCandle.timestamp && c.timestamp <= closestCandle.timestamp + LOOKFORWARD_MS
    );
    
    console.log(`      ⬅️ Before candles: ${beforeCandles.length}`);
    console.log(`      ➡️ After candles: ${afterCandles.length}`);
    
    scored++;
  }
  
  console.log(`\n   ✅ Successfully scored: ${scored}/${recentTokens.slice(0, 4).length} tokens`);
  console.log(`   📋 Issues found: ${issues.join(', ') || 'none'}`);
  
  return { issue: issues[0] || null, scored };
}

async function main() {
  console.log('🔬 WALLET SCORING DIAGNOSTIC\n');
  console.log('='.repeat(50));
  
  // Fetch current signals
  const data = await fetchSolSignals(10);
  const activities = data?.activities || [];
  const tokenInfoMap = data?.tokenInfoMap || {};
  console.log(`📥 Got ${activities.length} signal activities\n`);
  
  // Collect all wallets from first 3 signals
  const diagnosticResults = {
    total: 0,
    scored: 0,
    issues: {}
  };
  
  for (let i = 0; i < Math.min(3, activities.length); i++) {
    const activity = activities[i];
    const tokenKey = activity.tokenKey;
    const parts = tokenKey.split('!@#');
    const tokenAddress = parts[1];
    const tokenInfo = tokenInfoMap[tokenKey];
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 Signal ${i + 1}: ${tokenInfo?.symbol || 'Unknown'}`);
    console.log(`${'='.repeat(50)}`);
    
    const detail = await fetchSignalDetail(tokenAddress, activity.batchId, activity.batchIndex);
    const wallets = detail?.addresses || [];
    
    console.log(`👛 ${wallets.length} wallets in signal`);
    
    for (const w of wallets.slice(0, 3)) {
      const walletAddr = w.walletAddress || w.address;
      const result = await diagnoseWallet(walletAddr);
      
      diagnosticResults.total++;
      if (result.scored > 0) {
        diagnosticResults.scored++;
      }
      if (result.issue) {
        diagnosticResults.issues[result.issue] = (diagnosticResults.issues[result.issue] || 0) + 1;
      }
      
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  console.log(`\n\n${'='.repeat(50)}`);
  console.log('📊 DIAGNOSTIC SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total wallets analyzed: ${diagnosticResults.total}`);
  console.log(`Successfully scored: ${diagnosticResults.scored}`);
  console.log(`Success rate: ${((diagnosticResults.scored / diagnosticResults.total) * 100).toFixed(1)}%`);
  console.log(`\nIssue breakdown:`);
  for (const [issue, count] of Object.entries(diagnosticResults.issues)) {
    console.log(`  - ${issue}: ${count}`);
  }
}

main().catch(console.error);
