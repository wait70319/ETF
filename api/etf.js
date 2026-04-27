// api/etf.js — ETF 持股明細
// 資料來源：Yahoo Finance quoteSummary (公開，不需 API Key)
// 台股 ETF 自動加 .TW，美股 ETF 直接查

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');

  let { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  symbol = symbol.trim().toUpperCase();

  // 台股 ETF：補 .TW 後綴（若未帶）
  const isTW = /^[0-9]/.test(symbol);
  const yahooSym = isTW && !symbol.includes('.')
    ? symbol + '.TW'
    : symbol;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Referer': 'https://finance.yahoo.com/',
  };

  const ts = Date.now();

  try {
    // ── Yahoo Finance quoteSummary：topHoldings + assetProfile ─────
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSym)}` +
      `?modules=topHoldings%2CfundProfile%2Cprice&formatted=false&lang=zh-TW&region=TW&_=${ts}`;

    const r = await fetch(url, { headers });
    if (!r.ok) {
      // 嘗試 query2
      const url2 = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSym)}` +
        `?modules=topHoldings%2CfundProfile%2Cprice&formatted=false&_=${ts}`;
      const r2 = await fetch(url2, { headers });
      if (!r2.ok) {
        return res.status(r2.status).json({
          error: `查無此 ETF (${r2.status})，請確認代號是否正確`,
          symbol: yahooSym,
        });
      }
      const d2 = await r2.json();
      return res.status(200).json(parseResponse(symbol, yahooSym, d2));
    }

    const data = await r.json();
    return res.status(200).json(parseResponse(symbol, yahooSym, data));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function parseResponse(symbol, yahooSym, data) {
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error('資料結構異常，Yahoo Finance 可能暫時無資料');

  const th = result.topHoldings || {};
  const fp = result.fundProfile || {};
  const pr = result.price || {};

  // 持股清單
  const holdings = (th.holdings || []).map((h, i) => ({
    rank:       i + 1,
    symbol:     h.symbol || '',
    name:       h.holdingName || h.name || '',
    percentage: parseFloat(((h.holdingPercent || h.pct || 0) * 100).toFixed(4)),
  })).filter(h => h.percentage > 0);

  const top10 = holdings.slice(0, 10);
  const others = holdings.slice(10);
  const topTotal = top10.reduce((s, h) => s + h.percentage, 0);
  const othersTotal = others.reduce((s, h) => s + h.percentage, 0);

  return {
    symbol:       symbol,
    yahooSymbol:  yahooSym,
    name:         pr.longName || pr.shortName || fp.legalType || '',
    category:     fp.categoryName || fp.category || '',
    family:       fp.familyName || '',
    totalAssets:  pr.totalAssets?.fmt || null,
    expenseRatio: th.annualReportExpenseRatio
      ? (th.annualReportExpenseRatio * 100).toFixed(4) + '%'
      : (fp.annualReportExpenseRatio ? (fp.annualReportExpenseRatio * 100).toFixed(4) + '%' : null),
    bondPosition: th.bondPosition != null ? (th.bondPosition * 100).toFixed(2) + '%' : null,
    stockPosition: th.stockPosition != null ? (th.stockPosition * 100).toFixed(2) + '%' : null,
    equitySharesTop10: parseFloat(topTotal.toFixed(4)),
    top10,
    othersCount:  others.length,
    othersTotal:  parseFloat(othersTotal.toFixed(4)),
    allHoldings:  holdings,
    source:       'Yahoo Finance',
    fetchTime:    new Date().toISOString(),
  };
}
