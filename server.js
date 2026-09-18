import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_MS = 30_000;
const OIL_API_KEY = process.env.OIL_API_KEY || null;

let cache = { at: 0, data: null };

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  next();
});

async function fetchGoldSilver() {
  const resp = await fetch("https://xaus.com/api/v1/spot", {
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`xaus.com responded ${resp.status}`);
  const json = await resp.json();
  return {
    gold_usd_oz: json.spot_usd_oz ?? null,
    silver_usd_oz: json.silver_usd_oz ?? null,
    source: "xaus.com",
    fetched_at: new Date().toISOString(),
  };
}

async function fetchOil() {
  if (!OIL_API_KEY) {
    return {
      brent_usd_bbl: null,
      source: null,
      error: "OIL_API_KEY not configured — oil price unavailable until a key is set.",
    };
  }
  try {
    const resp = await fetch("https://api.oilpriceapi.com/v1/prices/latest?by_type=brent_crude", {
      headers: { Authorization: `Token ${OIL_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`oilpriceapi.com responded ${resp.status}`);
    const json = await resp.json();
    const price = json?.data?.price ?? null;
    return {
      brent_usd_bbl: price,
      source: "oilpriceapi.com",
      fetched_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      brent_usd_bbl: null,
      source: null,
      error: `oil fetch failed: ${err.message}`,
    };
  }
}

async function getPrices() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true };
  }

  const result = {
    gold_usd_oz: null,
    silver_usd_oz: null,
    brent_usd_bbl: null,
    errors: [],
    fetched_at: new Date().toISOString(),
  };

  try {
    const gs = await fetchGoldSilver();
    result.gold_usd_oz = gs.gold_usd_oz;
    result.silver_usd_oz = gs.silver_usd_oz;
    result.gold_silver_source = gs.source;
  } catch (err) {
    result.errors.push(`gold/silver fetch failed: ${err.message}`);
  }

  const oil = await fetchOil();
  result.brent_usd_bbl = oil.brent_usd_bbl;
  result.oil_source = oil.source;
  if (oil.error) result.errors.push(oil.error);

  cache = { at: now, data: result };
  return { ...result, cached: false };
}

app.get("/api/prices", async (req, res) => {
  try {
    const data = await getPrices();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`svix-live-prices listening on port ${PORT}`);
});
