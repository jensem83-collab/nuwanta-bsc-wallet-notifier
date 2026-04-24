// bscscan.js
// ------------------------------------------------------------------
// Moralis-backed wrapper for BSC wallet transactions.
//
// Why Moralis (not BscScan/Etherscan)?
//   BscScan's V1 API was deprecated in 2025, and Etherscan V2's free
//   tier does not include BSC. Moralis has a free tier that covers BSC.
//
// Exports (same shape as before, so nothing else has to change):
//   getNativeTransactions(address, limit)
//   getTokenTransactions(address, limit)
//   getAllRecentTransactions(address, limit)  -> merged + sorted newest first
//
// Notes for future-me:
// - Moralis auth uses a header: X-API-Key: <key>  (NOT a query param).
// - Moralis returns { result: [...] }. An empty wallet = empty array.
// - Amount formatting stays identical to the old code, so downstream
//   files (testBscscan.js, Phase 3 notifier) don't know we swapped.
// ------------------------------------------------------------------

require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.MORALIS_API_KEY;
const DEFAULT_WALLET = process.env.WALLET_ADDRESS;

const BASE_URL = 'https://deep-index.moralis.io/api/v2.2';
const CHAIN = 'bsc'; // Moralis chain slug for BNB Smart Chain (mainnet).

// Tiny sleep helper so we don't slam the API.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Format a raw integer token amount (as a string) into a human-friendly
// decimal string. Uses BigInt so we don't silently lose precision on
// tokens with 18 decimals + large balances (Number is only safe up to
// ~9e15). Caps displayed fraction at 8 digits and trims trailing zeros,
// then adds thousand separators to the integer part.
function formatAmount(rawValue, decimals) {
  try {
    const raw = BigInt(rawValue || '0');
    const d = Number(decimals) || 18;
    const divisor = 10n ** BigInt(d);
    const whole = raw / divisor;
    const fraction = raw % divisor;

    const fracPadded = fraction.toString().padStart(d, '0');
    const fracTrimmed = fracPadded.slice(0, 8).replace(/0+$/, '');
    const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return fracTrimmed ? `${wholeFormatted}.${fracTrimmed}` : wholeFormatted;
  } catch {
    // If BigInt parsing fails (unexpected input), fall back to "?" so
    // downstream code still renders something sensible.
    return '?';
  }
}

// Validate that something looks like a BSC address (0x + 40 hex chars).
function assertValidAddress(addr) {
  if (!addr || typeof addr !== 'string') {
    throw new Error('Wallet address is missing. Set WALLET_ADDRESS in .env');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw new Error(`Invalid BSC address: "${addr}"`);
  }
}

// Generic GET helper — keeps error handling in one place.
async function moralisGet(path, params) {
  if (!API_KEY) {
    throw new Error('Missing MORALIS_API_KEY in .env');
  }

  try {
    const { data } = await axios.get(`${BASE_URL}${path}`, {
      params: { chain: CHAIN, ...params },
      headers: {
        accept: 'application/json',
        'X-API-Key': API_KEY,
      },
      timeout: 15_000,
    });

    // Moralis always wraps results in { result: [...] }.
    return Array.isArray(data.result) ? data.result : [];
  } catch (err) {
    // Surface a clean error message for common cases.
    if (err.response) {
      const status = err.response.status;
      const msg = err.response.data?.message || err.response.statusText;
      if (status === 401) {
        throw new Error('Moralis 401 Unauthorized — check MORALIS_API_KEY in .env');
      }
      throw new Error(`Moralis HTTP ${status}: ${msg}`);
    }
    throw err; // timeout, DNS, etc.
  }
}

// --- Native BNB transactions ---------------------------------------
async function getNativeTransactions(address = DEFAULT_WALLET, limit = 10) {
  assertValidAddress(address);

  // Endpoint: /{address}  — returns native txs (sent + received).
  const raw = await moralisGet(`/${address}`, { limit, order: 'DESC' });

  // Normalise into the same shape the old BscScan code produced.
  return raw.map((tx) => ({
    type: 'BNB',
    hash: tx.hash,
    from: tx.from_address,
    to: tx.to_address,
    value: `${formatAmount(tx.value, 18)} BNB`,
    valueRaw: tx.value,
    timestamp: tx.block_timestamp, // already ISO-8601 from Moralis
    blockNumber: tx.block_number,
    isError: tx.receipt_status === '0',
    tokenSymbol: 'BNB',
    tokenName: 'BNB',
    possibleSpam: false,
  }));
}

// --- BEP-20 token transfers ----------------------------------------
async function getTokenTransactions(address = DEFAULT_WALLET, limit = 10) {
  assertValidAddress(address);

  // Endpoint: /{address}/erc20/transfers  — BEP-20 is ERC-20 on BSC.
  const raw = await moralisGet(`/${address}/erc20/transfers`, {
    limit,
    order: 'DESC',
  });

  return raw.map((tx) => {
    const decimals = Number(tx.token_decimals) || 18;
    // Replace null/empty symbol and name with "UNKNOWN" so we never
    // render the literal string "null" in a Telegram alert.
    const symbol = tx.token_symbol || 'UNKNOWN';
    const name = tx.token_name || 'Unknown token';
    return {
      type: 'BEP20',
      hash: tx.transaction_hash,
      from: tx.from_address,
      to: tx.to_address,
      value: `${formatAmount(tx.value, decimals)} ${symbol}`,
      valueRaw: tx.value,
      timestamp: tx.block_timestamp,
      blockNumber: tx.block_number,
      tokenSymbol: symbol,
      tokenName: name,
      contractAddress: tx.address,
      possibleSpam: tx.possible_spam === true,
    };
  });
}

// --- Combined, newest first ----------------------------------------
async function getAllRecentTransactions(address = DEFAULT_WALLET, limit = 5) {
  // Pull a slightly larger window from each endpoint so the merged
  // "top N newest" is accurate even when activity is lopsided.
  const fetchSize = Math.max(limit, 10);

  const native = await getNativeTransactions(address, fetchSize);
  await sleep(250); // be polite to rate limits
  const tokens = await getTokenTransactions(address, fetchSize);

  const merged = [...native, ...tokens].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  return merged.slice(0, limit);
}

module.exports = {
  getNativeTransactions,
  getTokenTransactions,
  getAllRecentTransactions,
};
