// FMP ticker map: Yahoo Frankfurt/XETRA tickers → FMP-recognized symbols
export const fmpTickerMap = {
  'AIR.DE':  'EADSY',  // Airbus
  'DTE.DE':  'DTEGY',  // Deutsche Telekom
  'ALV.DE':  'ALIZY',  // Allianz
  'NTO.F':   'NTDOY',  // Nintendo
  'RQ0.F':   'QBTS',   // D-Wave (QBTS on NYSE)
  '6RJ0.F':  'RKLB',   // Rocket Lab
  '3ZU0.F':  'ASTS',   // AST SpaceMobile
  '0YB0.F':  'IONQ',   // IonQ
  'A00.F':   'RGTI',   // Rigetti
  'RACE.MI': 'RACE',   // Ferrari
};

export async function fetchFmpFundamentals(sym, originalSym) {
  const key = process.env.FMP_API_KEY;
  if (!key) return {};
  const cleanSym = fmpTickerMap[sym] || fmpTickerMap[originalSym] || (originalSym || sym).split('.')[0];
  try {
    const [profileRes, metricsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/profile?symbol=${cleanSym}&apikey=${key}`),
      fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${cleanSym}&apikey=${key}`),
    ]);
    const profileArr = profileRes.ok ? await profileRes.json() : [];
    const metricsArr = metricsRes.ok ? await metricsRes.json() : [];
    const p = Array.isArray(profileArr) ? profileArr[0] : profileArr;
    const m = Array.isArray(metricsArr) ? metricsArr[0] : metricsArr;
    if (!p && !m) return {};
    return {
      marketCap:         p?.marketCap        || p?.mktCap                                    || null,
      pe:                m?.peRatioTTM        || m?.priceEarningsRatioTTM                     || null,
      eps:               m?.netIncomePerShareTTM || m?.epsTTM                                 || null,
      bookValuePerShare: m?.bookValuePerShareTTM                                              || null,
      pbRatio:           m?.pbRatioTTM                                                        || null,
      psRatio:           m?.priceToSalesRatioTTM                                              || null,
      evEbitda:          m?.enterpriseValueOverEBITDATTM || m?.evToEbitdaTTM                 || null,
      pegRatio:          m?.pegRatioTTM                                                       || null,
      roe:               m?.returnOnEquityTTM                                                 || null,
      avgVolume:         m?.volumeAvgTTM      || m?.averageInventoryTTM                       || null,
      dividendYield:     p?.dividendYield     || (p?.lastDiv && p?.price ? p.lastDiv / p.price : null) || null,
      sector:            p?.sector            || '',
      industry:          p?.industry          || '',
    };
  } catch { return {}; }
}
