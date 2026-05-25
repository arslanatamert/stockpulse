export default async function handler(req, res) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const yh = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/',
  };

  const eurMap = {
    'RKLB': '6RJ0.F', 'ASTS': '3ZU0.F', 'IONQ': '0YB0.F',
    'RGTI': 'A00.F',  'QUBT': 'QUBT',
  };

  const stocks = [
    { label: 'Airbus',           sym: 'AIR.DE'  },
    { label: 'Deutsche Telekom', sym: 'DTE.DE'  },
    { label: 'Allianz',          sym: 'ALV.DE'  },
    { label: 'Nintendo',         sym: 'NTO.F'   },
    { label: 'Rocket Lab',       sym: 'RKLB', resolved: '6RJ0.F' },
    { label: 'AST SpaceMobile',  sym: 'ASTS', resolved: '3ZU0.F' },
    { label: 'IonQ',             sym: 'IONQ', resolved: '0YB0.F' },
    { label: 'Rigetti',          sym: 'RGTI', resolved: 'A00.F'  },
    { label: 'D-Wave',           sym: 'RQ0.F'  },
    { label: 'QUBT',             sym: 'QUBT'   },
    { label: 'Ferrari',          sym: 'RACE.MI' },
    { label: 'BTC',              sym: 'BTC-EUR'  },
    { label: 'ETH',              sym: 'ETH-EUR'  },
    { label: 'SOL',              sym: 'SOL-EUR'  },
    { label: 'ADA',              sym: 'ADA-EUR'  },
    { label: 'TRX',              sym: 'TRX-EUR'  },
    { label: 'Polygon',          sym: 'MATIC-EUR' },
  ];

  const results = [];

  for (const stock of stocks) {
    const fetchSym = stock.resolved || stock.sym;
    const result = { label: stock.label, sym: stock.sym, fetchSym, checks: {} };

    try {
      // Fetch price + chart
      const [chartRes, chart2dRes] = await Promise.all([
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${fetchSym}?interval=1wk&range=1y`, { headers: yh }),
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${fetchSym}?interval=1d&range=5d`,  { headers: yh }),
      ]);

      result.checks.chart_status = chartRes.status;

      if (!chartRes.ok) {
        result.status = 'FAIL';
        result.error = `HTTP ${chartRes.status}`;
        results.push(result);
        continue;
      }

      const chartData = await chartRes.json();
      const r = chartData.chart?.result?.[0];
      const meta = r?.meta;

      if (!meta) {
        result.status = 'FAIL';
        result.error = 'No meta in chart response';
        results.push(result);
        continue;
      }

      // Price
      result.checks.price     = meta.regularMarketPrice ? `✓ ${meta.currency} ${meta.regularMarketPrice}` : '✗ missing';
      result.checks.currency  = meta.currency || '✗ missing';
      result.checks.name      = meta.longName || meta.shortName || '✗ missing';
      result.checks.exchange  = meta.fullExchangeName || meta.exchangeName || '✗ missing';

      // 52w
      result.checks['52w_high'] = meta.fiftyTwoWeekHigh ? `✓ ${meta.fiftyTwoWeekHigh}` : '✗ missing';
      result.checks['52w_low']  = meta.fiftyTwoWeekLow  ? `✓ ${meta.fiftyTwoWeekLow}`  : '✗ missing';

      // Daily change
      let prevClose = meta.regularMarketPreviousClose;
      if (!prevClose) {
        const d2 = await chart2dRes.json();
        prevClose = d2.chart?.result?.[0]?.meta?.chartPreviousClose || null;
      }
      if (prevClose && meta.regularMarketPrice) {
        const chg = ((meta.regularMarketPrice - prevClose) / prevClose * 100).toFixed(2);
        const sane = Math.abs(parseFloat(chg)) < 25; // >25% daily move = suspicious
        result.checks.daily_change = `${sane ? '✓' : '⚠'} ${chg}% (prev: ${prevClose})`;
      } else {
        result.checks.daily_change = '✗ missing prevClose';
      }

      // Chart points
      const closes = r.indicators?.quote?.[0]?.close || [];
      const validPts = closes.filter(v => v != null).length;
      result.checks.chart_points = validPts > 10 ? `✓ ${validPts} weekly points` : `⚠ only ${validPts} points`;

      // FMP fundamentals
      const fmpKey = process.env.FMP_API_KEY;
      // Skip FMP for crypto
      const isCrypto = stock.sym.includes('-EUR') || stock.sym.includes('-USD');
      if (fmpKey && !isCrypto) {
        const fmpMap = {
          'AIR.DE':'EADSY','DTE.DE':'DTEGY','ALV.DE':'ALIZY','NTO.F':'NTDOY',
          'RQ0.F':'QBTS','6RJ0.F':'RKLB','3ZU0.F':'ASTS','0YB0.F':'IONQ','A00.F':'RGTI',
        };
        const fmpSym = fmpMap[stock.fetchSym] || fmpMap[stock.sym] || stock.sym.split('.')[0];
        try {
          const fmpRes = await fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${fmpSym}&apikey=${fmpKey}`);
          const fmpData = fmpRes.ok ? await fmpRes.json() : [];
          const q = Array.isArray(fmpData) ? fmpData[0] : fmpData;
            const fmpP = Array.isArray(fmpData) ? fmpData[0] : fmpData;
          result.checks.fmp_marketCap = fmpP?.marketCap   ? `✓ ${(fmpP.marketCap/1e9).toFixed(1)}B`       : '✗ missing';
          result.checks.fmp_pe        = fmpP?.peRatioTTM  ? `✓ ${fmpP.peRatioTTM.toFixed(1)}`             : '— N/A (ok for growth stocks)';
          result.checks.fmp_volume    = fmpP?.volumeAvgTTM ? `✓ ${Math.round(fmpP.volumeAvgTTM).toLocaleString()}` : '⚠ missing';
          result.checks.fmp_dividend  = fmpP?.dividendYield ? `✓ ${(fmpP.dividendYield*100).toFixed(2)}%` : '— none';
        } catch (e) {
          result.checks.fmp_marketCap = `✗ error: ${e.message}`;
        }
      } else {
        result.checks.fmp_note = '⚠ FMP_API_KEY not set — skipping fundamentals';
      }

      // Overall pass/fail
      const failures = Object.values(result.checks).filter(v => String(v).startsWith('✗')).length;
      const warnings = Object.values(result.checks).filter(v => String(v).startsWith('⚠')).length;
      result.status = failures > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS';

    } catch (err) {
      result.status = 'ERROR';
      result.error = err.message;
    }

    results.push(result);
  }

  const summary = {
    pass: results.filter(r => r.status === 'PASS').length,
    warn: results.filter(r => r.status === 'WARN').length,
    fail: results.filter(r => r.status === 'FAIL' || r.status === 'ERROR').length,
    total: results.length,
  };

  res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify({ summary, results }, null, 2));
}
