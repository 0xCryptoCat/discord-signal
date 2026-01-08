/**
 * Check the 7-day filter impact on wallet scoring
 */

const ENDPOINTS = {
  filterActivity: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview',
  signalDetail: 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail',
  tradingHistory: 'https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list',
  candles: 'https://web3.okx.com/priapi/v5/dex/token/market/dex-token-hlc-candles',
};

async function checkSevenDayFilter() {
  console.log('🔬 CHECKING 7-DAY FILTER IMPACT\n');
  console.log('='.repeat(60));
  
  // Get fresh signals
  const signalUrl = `${ENDPOINTS.filterActivity}?t=${Date.now()}`;
  
  const signalRes = await fetch(signalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: 501,
      trend: '1',
      signalLabelList: [1, 2, 3],
      protocolIdList: [],
      tokenMetricsFilter: {},
      signalMetricsFilter: {},
      pageSize: 5
    })
  });

  const signalData = await signalRes.json();
  const activities = signalData.data?.activityList || [];
  
  if (activities.length === 0) {
    console.log('❌ No activities right now');
    return;
  }
  
  // Get wallets from first signal
  const act = activities[0];
  const tokenAddress = act.tokenKey.split('!@#')[1];
  
  const detailUrl = `${ENDPOINTS.signalDetail}?chainId=501&tokenContractAddress=${tokenAddress}&batchId=${act.batchId}&batchIndex=${act.batchIndex}&t=${Date.now()}`;
  const detailRes = await fetch(detailUrl);
  const detailData = await detailRes.json();
  const wallets = detailData.data?.addresses || [];
  
  console.log(`Analyzing ${wallets.length} wallets from signal...\n`);
  
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  
  let stats = {
    total: 0,
    with7d: 0,
    with14d: 0,
    with30d: 0,
    withAll: 0,
  };
  
  for (let i = 0; i < Math.min(5, wallets.length); i++) {
    const w = wallets[i];
    console.log(`\n📊 Wallet ${i + 1}: ${w.walletAddress.slice(0, 12)}...`);
    
    // Fetch with higher limit
    const url = `${ENDPOINTS.tradingHistory}?walletAddress=${w.walletAddress}&chainId=501&isAsc=false&sortType=1&offset=0&limit=50&t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    const tokens = data.data?.tokenList || [];
    
    console.log(`   Total tokens: ${tokens.length}`);
    
    stats.total++;
    
    // Count by time filter
    const recent7d = tokens.filter(t => parseInt(t.latestTime) >= sevenDaysAgo);
    const recent14d = tokens.filter(t => parseInt(t.latestTime) >= fourteenDaysAgo);
    const recent30d = tokens.filter(t => parseInt(t.latestTime) >= thirtyDaysAgo);
    
    console.log(`   7d tokens: ${recent7d.length}`);
    console.log(`   14d tokens: ${recent14d.length}`);
    console.log(`   30d tokens: ${recent30d.length}`);
    
    if (recent7d.length > 0) stats.with7d++;
    if (recent14d.length > 0) stats.with14d++;
    if (recent30d.length > 0) stats.with30d++;
    if (tokens.length > 0) stats.withAll++;
    
    // Check if any tokens have buys
    const withBuys7d = recent7d.filter(t => t.totalTxBuy > 0 && parseFloat(t.buyAvgPrice) > 0);
    const withBuys30d = recent30d.filter(t => t.totalTxBuy > 0 && parseFloat(t.buyAvgPrice) > 0);
    
    console.log(`   7d with buys: ${withBuys7d.length}`);
    console.log(`   30d with buys: ${withBuys30d.length}`);
    
    if (withBuys7d.length === 0 && withBuys30d.length > 0) {
      console.log(`   ⚠️ WOULD FAIL 7D FILTER BUT HAS 30D DATA!`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY');
  console.log(`   Wallets with 7d tokens: ${stats.with7d}/${stats.total}`);
  console.log(`   Wallets with 14d tokens: ${stats.with14d}/${stats.total}`);
  console.log(`   Wallets with 30d tokens: ${stats.with30d}/${stats.total}`);
  console.log(`   Wallets with any tokens: ${stats.withAll}/${stats.total}`);
  
  console.log('\n💡 RECOMMENDATION:');
  if (stats.with7d < stats.with30d) {
    console.log('   Extend timeframe to 30 days for better coverage!');
  } else {
    console.log('   7-day filter is working well.');
  }
}

checkSevenDayFilter().catch(console.error);
