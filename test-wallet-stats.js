/**
 * Test wallet stats from signal-detail
 */

async function test() {
  // First get fresh signals
  const signalUrl = 'https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal/filter-activity-overview?t=' + Date.now();
  const body = {
    chainId: 501,
    trend: '1',
    signalLabelList: [1, 2, 3],
    protocolIdList: [],
    tokenMetricsFilter: {},
    signalMetricsFilter: {},
    pageSize: 5
  };

  const signalRes = await fetch(signalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const signalData = await signalRes.json();
  let activities = signalData.data?.activities || [];
  let chainId = 501;
  
  console.log('SOL Activities:', activities.length);
  
  if (activities.length === 0) {
    console.log('No SOL activities, trying ETH...');
    body.chainId = 1;
    chainId = 1;
    const ethRes = await fetch(signalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const ethData = await ethRes.json();
    activities = ethData.data?.activities || [];
    console.log('ETH Activities:', activities.length);
  }
  
  if (activities.length === 0) {
    console.log('No activities available right now');
    return;
  }
  
  const act = activities[0];
  const tokenKey = act.tokenKey;
  const parts = tokenKey.split('!@#');
  const tokenAddress = parts[1];
  
  console.log('\nToken:', tokenAddress);
  console.log('Batch:', act.batchId, act.batchIndex);
  
  // Get signal detail with wallet stats
  const detailUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/smartmoney/signal-detail?chainId=${chainId}&tokenContractAddress=${tokenAddress}&batchId=${act.batchId}&batchIndex=${act.batchIndex}&t=${Date.now()}`;
  const detailRes = await fetch(detailUrl);
  const detailData = await detailRes.json();
  const addrs = detailData.data?.addresses || [];
  
  console.log('Wallets in signal:', addrs.length);
  
  for (let i = 0; i < Math.min(3, addrs.length); i++) {
    const w = addrs[i];
    console.log(`\n--- Wallet ${i + 1}: ${w.walletAddress?.slice(0, 12)}... ---`);
    console.log('  pnl7d:', w.pnl7d);
    console.log('  roi:', w.roi);
    console.log('  winRate:', w.winRate);
    console.log('  tags:', w.tags);
    console.log('  kolAddress:', w.addressInfo?.kolAddress);
    console.log('  twitterHandle:', w.addressInfo?.twitterHandle);
    
    // Test trading history for this wallet
    const histUrl = `https://web3.okx.com/priapi/v1/dx/market/v2/pnl/token-list?walletAddress=${w.walletAddress}&chainId=${chainId}&isAsc=false&sortType=2&offset=0&limit=15&filterRisk=false&filterSmallBalance=false&filterEmptyBalance=false&t=${Date.now()}`;
    const histRes = await fetch(histUrl);
    const histData = await histRes.json();
    const tokens = histData.data?.tokenList || [];
    console.log('  Trading history tokens:', tokens.length);
    
    if (tokens.length > 0) {
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const recentTokens = tokens.filter(t => parseInt(t.latestTime, 10) >= sevenDaysAgo);
      console.log('  Recent tokens (7d):', recentTokens.length);
      
      if (recentTokens.length > 0) {
        const t = recentTokens[0];
        console.log('  First token:', t.tokenSymbol, '- buys:', t.totalTxBuy, 'buyAvgPrice:', t.buyAvgPrice);
      }
    }
  }
  
  console.log('\n=== SOLUTION ===');
  console.log('When trading history is empty, fall back to OKX pre-calculated stats:');
  console.log('  - Use pnl7d, roi, winRate from signal-detail response');
  console.log('  - Calculate a pseudo-score based on these metrics');
}

test().catch(console.error);
