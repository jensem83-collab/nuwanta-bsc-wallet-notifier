// prices.js
// ------------------------------------------------------------------
// Lightweight USD price helper.
//
// Design choices:
// - BNB: CoinGecko simple price API (free, no key, no Moralis CU cost).
//   Cached for 60s so we don't hammer it.
// - Stablecoins (USDT/USDC/BUSD/DAI): hardcoded $1. Accurate enough
//   and avoids a network round-trip.
// - Arbitrary BEP-20 tokens: returns null (caller should render the
//   amount without a USD figure). We skip these to keep the free-tier
//   Moralis budget headroom; can be added later.
// ------------------------------------------------------------------

const axios = require('axios');

const CACHE_TTL_MS = 60_000;

// Uppercase symbols → USD value per 1 token. Stables assume 1:1.
const HARDCODED = {
  USDT: 1,
  USDC: 1,
  BUSD: 1,
  DAI: 1,
  TUSD: 1,
};

let bnbCache = { price: null, fetchedAt: 0 };

async function getBnbPriceUsd() {
  const now = Date.now();
  if (bnbCache.price && now - bnbCache.fetchedAt < CACHE_TTL_MS) {
    return bnbCache.price;
  }
  try {
    const { data } = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: { ids: 'binancecoin', vs_currencies: 'usd' },
        timeout: 8_000,
      }
    );
    const price = Number(data?.binancecoin?.usd);
    if (Number.isFinite(price) && price > 0) {
      bnbCache = { price, fetchedAt: now };
      return price;
    }
  } catch (err) {
    console.warn(`⚠️  CoinGecko BNB price fetch failed: ${err.message}`);
  }
  // Fall back to the last cached value even if it's stale — better
  // than nothing, and callers also tolerate null.
  return bnbCache.price;
}

// Return USD value for a tx, or null if we can't price it cheaply.
// `amountStr` is the human-readable numeric string (e.g. "0.5" from
// formatAmount), with thousand separators stripped before parsing.
async function priceTxUsd(tx) {
  const rawAmount = parseFloat(tx.value.split(' ')[0].replace(/,/g, ''));
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return null;

  const symbol = (tx.tokenSymbol || '').toUpperCase();

  if (symbol === 'BNB') {
    const price = await getBnbPriceUsd();
    return price ? rawAmount * price : null;
  }

  if (HARDCODED[symbol] !== undefined) {
    return rawAmount * HARDCODED[symbol];
  }

  return null; // unknown token — amount shown without USD
}

module.exports = { priceTxUsd, getBnbPriceUsd };
