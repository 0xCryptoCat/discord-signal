/**
 * Investigate why trading history API returns empty for some wallets
 * These wallets are in the signal, so they should have at least 1 trade
 */

const ENDPOINTS = {
  filterActivity: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview',
  signalDetail: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail',
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
};

async function investigate() {
  console.log('🔬 INVESTIGATING TRADING HISTORY API\n');
  console.log('='.repeat(60));
  
  // Get fresh signals
  const t = Date.now();
  const signalUrl = `${ENDPOINTS.filterActivity}?t=${t}`;
  
  const body = {
    chainId: 501,
    trend: '1',
    signalLabelList: [1, 2, 3],
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize: 3
  };

  const signalRes = await fetch(signalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const signalData = await signalRes.json();
  const activities = signalData.data?.activityList || [];
  
  if (activities.length === 0) {
    console.log('❌ No activities right now, try again later');
    return;
  }
  
  console.log(`✅ Got ${activities.length} activities\n`);
  
  // Get first signal details
  const act = activities[0];
  const tokenKey = act.tokenKey;
  const tokenAddress = tokenKey.split('!@#')[1];
  
  console.log('Token:', tokenAddress);
  console.log('BatchId:', act.batchId, 'BatchIndex:', act.batchIndex);
  
  // Get wallets from signal detail
  const detailUrl = `${ENDPOINTS.signalDetail}?chainId=501&tokenContractAddress=${tokenAddress}&batchId=${act.batchId}&batchIndex=${act.batchIndex}&t=${Date.now()}`;
  const detailRes = await fetch(detailUrl);
  const detailData = await detailRes.json();
  const wallets = detailData.data?.addresses || [];
  
  console.log(`\n👛 Wallets in signal: ${wallets.length}\n`);
  
  for (let i = 0; i < Math.min(3, wallets.length); i++) {
    const w = wallets[i];
    console.log('='.repeat(60));
    console.log(`Wallet ${i + 1}: ${w.walletAddress}`);
    console.log('Tags:', w.tags);
    console.log('OKX Stats - pnl7d:', w.pnl7d, 'roi:', w.roi, 'winRate:', w.winRate);
    
    console.log('\n📊 Testing different trading history params...\n');
    
    // Test 1: Default params (current implementation)
    const url1 = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=false&sortType=2&offset=0&limit=15&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    const res1 = await fetch(url1);
    const data1 = await res1.json();
    console.log('  1. Default (sortType=2, filterSmallBalance=false):', data1.data?.tokenList?.length || 0, 'tokens');
    
    // Test 2: Without any filters
    const url2 = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=false&sortType=2&offset=0&limit=50&t=${Date.now()}`;
    const res2 = await fetch(url2);
    const data2 = await res2.json();
    console.log('  2. No filter params:', data2.data?.tokenList?.length || 0, 'tokens');
    
    // Test 3: sortType=1 (by time instead of PnL)
    const url3 = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=false&sortType=1&offset=0&limit=50&t=${Date.now()}`;
    const res3 = await fetch(url3);
    const data3 = await res3.json();
    console.log('  3. sortType=1 (by time):', data3.data?.tokenList?.length || 0, 'tokens');
    
    // Test 4: sortType=0
    const url4 = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=false&sortType=0&offset=0&limit=50&t=${Date.now()}`;
    const res4 = await fetch(url4);
    const data4 = await res4.json();
    console.log('  4. sortType=0:', data4.data?.tokenList?.length || 0, 'tokens');
    
    // Test 5: isAsc=true
    const url5 = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=true&sortType=2&offset=0&limit=50&t=${Date.now()}`;
    const res5 = await fetch(url5);
    const data5 = await res5.json();
    console.log('  5. isAsc=true:', data5.data?.tokenList?.length || 0, 'tokens');
    
    // Test 6: Different limit
    const url6 = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=false&sortType=2&offset=0&limit=100&t=${Date.now()}`;
    const res6 = await fetch(url6);
    const data6 = await res6.json();
    console.log('  6. limit=100:', data6.data?.tokenList?.length || 0, 'tokens');
    
    // Find best result
    const allResults = [data1, data2, data3, data4, data5, data6];
    const bestResult = allResults.reduce((best, curr) => {
      const currLen = curr.data?.tokenList?.length || 0;
      const bestLen = best.data?.tokenList?.length || 0;
      return currLen > bestLen ? curr : best;
    });
    
    const tokens = bestResult.data?.tokenList || [];
    if (tokens.length > 0) {
      console.log('\n  📋 First 3 tokens from best result:');
      for (let j = 0; j < Math.min(3, tokens.length); j++) {
        const t = tokens[j];
        const daysAgo = ((Date.now() - parseInt(t.latestTime)) / (1000 * 60 * 60 * 24)).toFixed(1);
        console.log(`     - ${t.tokenSymbol}: buys=${t.totalTxBuy}, buyAvgPrice=${t.buyAvgPrice}, ${daysAgo}d ago`);
      }
    } else {
      console.log('\n  ❌ ALL PARAMS RETURNED EMPTY!');
      console.log('  Raw response sample:', JSON.stringify(data1).slice(0, 200));
    }
    
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log('\n📋 SUMMARY');
  console.log('If all params return empty, the wallet may be:');
  console.log('  - Very new (just made first trade in this signal)');
  console.log('  - OKX indexing delay');
  console.log('  - Need to use a different endpoint');
}

investigate().catch(console.error);
