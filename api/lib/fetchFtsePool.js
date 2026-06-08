// Fetches FTSE All-World-equivalent holdings via Vanguard's US-listed VT ETF on FMP.
// VT tracks the FTSE Global All-Cap Index — same universe as VWCE (FTSE All-World).
// Results are cached in Redis for 7 days to avoid repeated FMP calls.
// Returns array of { sym, label } ready for Yahoo Finance price fetching.

async function upstashGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const { result } = await r.json();
  return result;
}

async function upstashSet(key, value, ttlSeconds) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([['SET', key, value, 'EX', ttlSeconds]]),
  });
}

// Top-50 FTSE All-World holdings as of Jun 2026 — used if FMP is unavailable.
const FALLBACK_POOL = [
  { sym: 'NVDA',  label: 'Nvidia'              },
  { sym: 'AAPL',  label: 'Apple'               },
  { sym: 'MSFT',  label: 'Microsoft'           },
  { sym: 'AMZN',  label: 'Amazon'              },
  { sym: 'GOOGL', label: 'Alphabet'            },
  { sym: 'AVGO',  label: 'Broadcom'            },
  { sym: 'META',  label: 'Meta'                },
  { sym: 'TSM',   label: 'TSMC'                },
  { sym: 'TSLA',  label: 'Tesla'               },
  { sym: 'JPM',   label: 'JPMorgan'            },
  { sym: 'LLY',   label: 'Eli Lilly'           },
  { sym: 'V',     label: 'Visa'                },
  { sym: 'XOM',   label: 'ExxonMobil'          },
  { sym: 'UNH',   label: 'UnitedHealth'        },
  { sym: 'MA',    label: 'Mastercard'          },
  { sym: 'JNJ',   label: 'Johnson & Johnson'   },
  { sym: 'NFLX',  label: 'Netflix'             },
  { sym: 'COST',  label: 'Costco'              },
  { sym: 'WMT',   label: 'Walmart'             },
  { sym: 'ORCL',  label: 'Oracle'              },
  { sym: 'BAC',   label: 'Bank of America'     },
  { sym: 'PG',    label: 'P&G'                 },
  { sym: 'HD',    label: 'Home Depot'          },
  { sym: 'GS',    label: 'Goldman Sachs'       },
  { sym: 'ABBV',  label: 'AbbVie'              },
  { sym: 'AMD',   label: 'AMD'                 },
  { sym: 'MRK',   label: 'Merck'               },
  { sym: 'CVX',   label: 'Chevron'             },
  { sym: 'CRM',   label: 'Salesforce'          },
  { sym: 'DIS',   label: 'Disney'              },
  { sym: 'ASML',  label: 'ASML'                },
  { sym: 'NVO',   label: 'Novo Nordisk'        },
  { sym: 'SAP',   label: 'SAP'                 },
  { sym: 'TM',    label: 'Toyota'              },
  { sym: 'SONY',  label: 'Sony'                },
  { sym: 'BABA',  label: 'Alibaba'             },
  { sym: 'INFY',  label: 'Infosys'             },
  { sym: 'AZN',   label: 'AstraZeneca'         },
  { sym: 'SHEL',  label: 'Shell'               },
  { sym: 'HSBC',  label: 'HSBC'                },
  { sym: 'NSRGY', label: 'Nestlé'              },
  { sym: 'RHHBY', label: 'Roche'               },
  { sym: 'NVS',   label: 'Novartis'            },
  { sym: 'BP',    label: 'BP'                  },
  { sym: 'GSK',   label: 'GSK'                 },
  { sym: 'LVMUY', label: 'LVMH'               },
  { sym: 'LRLCY', label: "L'Oréal"             },
  { sym: 'TCEHY', label: 'Tencent'             },
  { sym: 'INTC',  label: 'Intel'               },
  { sym: 'BRK-B', label: 'Berkshire Hathaway'  },
];

const CACHE_KEY = 'report:ftse_pool';
const CACHE_TTL = 7 * 24 * 3600; // 7 days

export async function fetchFtsePool() {
  // 1. Try Redis cache
  const cached = await upstashGet(CACHE_KEY);
  if (cached) {
    try {
      const pool = JSON.parse(cached);
      if (Array.isArray(pool) && pool.length >= 20) return pool;
    } catch {}
  }

  // 2. Try FMP ETF holdings for VT (Vanguard Total World Stock ETF)
  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) return FALLBACK_POOL;

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/etf-holdings?symbol=VT&apikey=${fmpKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return FALLBACK_POOL;

    const data = await res.json();
    if (!Array.isArray(data) || data.length < 10) return FALLBACK_POOL;

    // Keep only clean US tickers with meaningful weight (>0.03%) to avoid micro-caps
    const pool = data
      .filter(h => {
        const sym = h.symbol || h.asset || '';
        const weight = Number(h.weightPercentage || 0);
        return /^[A-Z]{1,5}$/.test(sym) && weight > 0.03;
      })
      .map(h => ({
        sym:   h.symbol || h.asset,
        label: h.name   || h.symbol || h.asset,
      }));

    if (pool.length < 20) return FALLBACK_POOL;

    await upstashSet(CACHE_KEY, JSON.stringify(pool), CACHE_TTL);
    return pool;
  } catch {
    return FALLBACK_POOL;
  }
}
