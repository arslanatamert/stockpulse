export default async function handler(req, res) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const key = process.env.FMP_API_KEY;
  if (!key) res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify({ error: 'FMP_API_KEY not set' })); return;

  // Full list: FMP ticker → display name
  const stocks = [
    { fmp: 'EADSY',  label: 'Airbus'           },
    { fmp: 'DTEGY',  label: 'Deutsche Telekom'  },
    { fmp: 'ALIZY',  label: 'Allianz'           },
    { fmp: 'NTDOY',  label: 'Nintendo'          },
    { fmp: 'RACE',   label: 'Ferrari'           },
    { fmp: 'RKLB',   label: 'Rocket Lab'        },
    { fmp: 'ASTS',   label: 'AST SpaceMobile'   },
    { fmp: 'IONQ',   label: 'IonQ'              },
    { fmp: 'RGTI',   label: 'Rigetti'           },
    { fmp: 'QBTS',   label: 'D-Wave'            },
    { fmp: 'QUBT',   label: 'QUBT'              },
  ];

  const results = {};
  const summary = { pass: 0, partial: 0, fail: 0 };

  for (const { fmp, label } of stocks) {
    try {
      const [pRes, mRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/profile?symbol=${fmp}&apikey=${key}`),
        fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${fmp}&apikey=${key}`),
      ]);
      const pArr = pRes.ok ? await pRes.json() : [];
      const mArr = mRes.ok ? await mRes.json() : [];
      const p = Array.isArray(pArr) ? pArr[0] : pArr;
      const m = Array.isArray(mArr) ? mArr[0] : mArr;

      const marketCap    = p?.marketCap   ?? null;
      const pe           = m?.peRatioTTM  ?? m?.priceEarningsRatioTTM ?? null;
      const avgVolume    = m?.volumeAvgTTM ?? null;
      const dividendYield = p?.dividendYield ?? null;
      const name         = p?.companyName ?? p?.name ?? null;

      const fields = { marketCap, pe, avgVolume, dividendYield };
      const present = Object.values(fields).filter(v => v !== null).length;
      const status = present === 4 ? 'PASS' : present >= 2 ? 'PARTIAL' : 'FAIL';
      summary[status === 'PASS' ? 'pass' : status === 'PARTIAL' ? 'partial' : 'fail']++;

      results[label] = {
        status,
        fmpTicker:     fmp,
        profileStatus: pRes.status,
        metricsStatus: mRes.status,
        name:          name        ?? '✗ missing',
        marketCap:     marketCap   ? '✓ ' + (marketCap/1e9).toFixed(1) + 'B' : '✗ missing',
        pe:            pe          ? '✓ ' + pe.toFixed(1) : '✗ missing',
        avgVolume:     avgVolume   ? '✓ ' + Math.round(avgVolume).toLocaleString() : '✗ missing',
        dividendYield: dividendYield ? '✓ ' + (dividendYield*100).toFixed(2)+'%' : '— none/missing',
      };
    } catch(e) {
      summary.fail++;
      results[label] = { status: 'ERROR', error: e.message };
    }
  }

  res.setHeader('Access-Control-Allow-Origin','*').setHeader('Content-Type','application/json').status(200).send(JSON.stringify({ keyPreview: key.slice(0,6)+'...', summary, results }, null, 2));
}
