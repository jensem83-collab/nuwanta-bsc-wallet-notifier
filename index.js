// =====================================================================
// index.js  —  MAIN BOT (Phase 6: multi-wallet + USD prices + polish)
// =====================================================================
// WHAT THIS DOES
//   1. Loads a list of wallets from .env (WALLET_ADDRESSES=0x..,0x..).
//      Optional per-wallet labels via WALLET_LABELS (same order).
//   2. For each wallet, polls Moralis every POLL_INTERVAL_SEC.
//      - Detects new BNB + BEP-20 transactions vs lastSeen.json.
//      - Posts a Telegram alert with amount, USD value (when pricable),
//        direction, wallet label, time, and a BscScan link.
//   3. Errors on one wallet/endpoint never affect others.
//   4. Ctrl+C exits cleanly.
//
// RUN WITH:   npm start
// =====================================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const {
  getNativeTransactions,
  getTokenTransactions,
} = require('./bscscan');
const lastSeenStore = require('./lastSeen');
const { priceTxUsd } = require('./prices');

// --- Small formatting helpers (declared early so config can use them) ---

function short(str) {
  if (!str) return '(unknown)';
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

// Escape Telegram "Markdown" reserved chars in user-provided strings
// (wallet labels, token names) so they can't accidentally trigger
// formatting or break the parser entirely. The four chars Telegram's
// legacy Markdown mode treats as special: _ * ` [
function mdEscape(s) {
  return String(s ?? '').replace(/[_*`\[]/g, '\\$&');
}

// Render a USD number with sensible precision:
//   >= $1000 → no decimals,  >= $1 → 2 decimals,  < $1 → 4 decimals.
function fmtUsd(value) {
  if (value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

// --- Config ----------------------------------------------------------

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Prefer WALLET_ADDRESSES (comma-separated). Fall back to the legacy
// single WALLET_ADDRESS so old .env files keep working.
const rawAddresses =
  process.env.WALLET_ADDRESSES || process.env.WALLET_ADDRESS || '';
const addresses = rawAddresses
  .split(',')
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

// Optional nicknames (positional — match the order of addresses).
const labels = (process.env.WALLET_LABELS || '').split(',').map((l) => l.trim());

const WALLETS = addresses.map((address, i) => ({
  address,
  label: labels[i] || short(address),
}));

const POLL_INTERVAL_MS = (Number(process.env.POLL_INTERVAL_SEC) || 60) * 1000;
const FETCH_LIMIT      = 20;
const FILTER_SPAM = (process.env.FILTER_SPAM ?? 'true').toLowerCase() !== 'false';

// --- Startup validation ---------------------------------------------

if (!TOKEN)   { console.error('❌ TELEGRAM_BOT_TOKEN missing in .env'); process.exit(1); }
if (!CHAT_ID) { console.error('❌ TELEGRAM_CHAT_ID missing in .env');   process.exit(1); }
if (WALLETS.length === 0) {
  console.error('❌ No wallets configured. Set WALLET_ADDRESSES or WALLET_ADDRESS in .env.');
  process.exit(1);
}
for (const w of WALLETS) {
  if (!/^0x[a-f0-9]{40}$/.test(w.address)) {
    console.error(`❌ Invalid BSC address: ${w.address}`);
    process.exit(1);
  }
}

// polling:false — we only SEND messages, never LISTEN.
const bot = new TelegramBot(TOKEN, { polling: false });

// --- Per-tx helpers -------------------------------------------------

// Returns { kind, icon } so callers can branch on `kind` (stable enum)
// while UI uses `icon` (decorative). Keeps display and logic decoupled.
function direction(tx, watchAddress) {
  const me = watchAddress.toLowerCase();
  if (tx.from?.toLowerCase() === me) return { kind: 'OUT',   icon: '📤' };
  if (tx.to?.toLowerCase()   === me) return { kind: 'IN',    icon: '📥' };
  return                              { kind: 'OTHER', icon: '↔️' };
}

// Build the Telegram message body for one tx. Async because it may
// fetch a USD price (CoinGecko for BNB, hardcoded for stables).
async function formatTx(tx, wallet) {
  const dir = direction(tx, wallet.address);
  const isOut = dir.kind === 'OUT';
  const other = isOut ? tx.to : tx.from;

  const usd = await priceTxUsd(tx);
  const usdStr = fmtUsd(usd);
  const amountLine = usdStr
    ? `Amount: *${tx.value}* (~${usdStr})\n`
    : `Amount: *${tx.value}*\n`;

  const nameLine =
    tx.type === 'BEP20' && tx.tokenName && tx.tokenName !== tx.tokenSymbol
      ? `Token: ${mdEscape(tx.tokenName)}\n`
      : '';

  const spamFlag = tx.possibleSpam ? '⚠️ *possible spam*\n' : '';

  return (
    `*${mdEscape(wallet.label)}* — ${dir.icon} ${dir.kind}  *${tx.type}*\n` +
    spamFlag +
    amountLine +
    nameLine +
    `${isOut ? 'To' : 'From'}: \`${short(other)}\`\n` +
    `Time: ${new Date(tx.timestamp).toLocaleString()}\n` +
    `Tx: \`${short(tx.hash)}\`\n` +
    `[View on BscScan](https://bscscan.com/tx/${tx.hash})`
  );
}

// Wrap Telegram sends in try/catch — a failed send shouldn't crash the loop.
async function notify(text) {
  try {
    await bot.sendMessage(CHAT_ID, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('⚠️  Telegram send failed:', err.message);
  }
}

// --- Diff helper ----------------------------------------------------

// Given txs (newest first) and a lastSeen hash, return only the txs
// that came AFTER that hash, in chronological (oldest first) order.
function sliceNew(txsNewestFirst, lastSeenHash) {
  if (!lastSeenHash) return [];
  const idx = txsNewestFirst.findIndex((t) => t.hash === lastSeenHash);
  const newOnes = idx === -1 ? txsNewestFirst : txsNewestFirst.slice(0, idx);
  return newOnes.reverse();
}

// --- One wallet's tick ---------------------------------------------

async function tickOneWallet(wallet, state) {
  const key = wallet.address;
  if (!state[key]) state[key] = { bnb: null, bep20: null };

  const [nativeResult, tokensResult] = await Promise.allSettled([
    getNativeTransactions(wallet.address, FETCH_LIMIT),
    getTokenTransactions(wallet.address, FETCH_LIMIT),
  ]);

  if (nativeResult.status === 'rejected') {
    console.warn(`⚠️  [${wallet.label}] BNB fetch failed: ${nativeResult.reason.message}`);
  }
  if (tokensResult.status === 'rejected') {
    console.warn(`⚠️  [${wallet.label}] BEP-20 fetch failed: ${tokensResult.reason.message}`);
  }

  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : [];
  const tokens = tokensResult.status === 'fulfilled' ? tokensResult.value : [];

  const newNative = sliceNew(native, state[key].bnb);
  const newTokens = sliceNew(tokens, state[key].bep20);

  let newAll = [...newNative, ...newTokens].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  if (FILTER_SPAM) {
    const before = newAll.length;
    newAll = newAll.filter((tx) => !tx.possibleSpam);
    const skipped = before - newAll.length;
    if (skipped > 0) console.log(`   [${wallet.label}] skipped ${skipped} spam transfer(s)`);
  }

  for (const tx of newAll) {
    console.log(`🔔 [${wallet.label}] new ${tx.type} tx: ${tx.hash}`);
    await notify(await formatTx(tx, wallet));
  }

  if (native.length) state[key].bnb   = native[0].hash;
  if (tokens.length) state[key].bep20 = tokens[0].hash;

  return newAll.length;
}

// Full tick: loop over every configured wallet sequentially.
async function tick(state) {
  let total = 0;
  for (const wallet of WALLETS) {
    total += await tickOneWallet(wallet, state);
  }
  lastSeenStore.save(state);
  return total;
}

// --- Legacy-schema migration ---------------------------------------

// Phase 3 wrote flat state: { bnb, bep20 }.
// Phase 6 writes nested:    { "0x...": { bnb, bep20 } }.
// Move the flat keys under the first wallet on first start after upgrade.
function migrateLegacy(state) {
  const hasLegacyKeys = state && (state.bnb || state.bep20);
  const hasNestedKeys = state && WALLETS.some((w) => state[w.address]);
  if (hasLegacyKeys && !hasNestedKeys && WALLETS.length > 0) {
    const primary = WALLETS[0].address;
    console.log(`Migrating legacy lastSeen.json under wallet ${primary}`);
    return {
      [primary]: { bnb: state.bnb || null, bep20: state.bep20 || null },
    };
  }
  return state || {};
}

// --- Main loop -----------------------------------------------------

(async () => {
  console.log('--------------------------------------------------');
  console.log(' BSC Wallet Notifier — Phase 6');
  console.log(` Wallets : ${WALLETS.length}`);
  for (const w of WALLETS) console.log(`   - ${w.label}: ${w.address}`);
  console.log(` Poll    : every ${POLL_INTERVAL_MS / 1000}s per cycle`);
  console.log(` Spam    : ${FILTER_SPAM ? 'hidden' : 'shown'}`);
  console.log('--------------------------------------------------');

  let state = migrateLegacy(lastSeenStore.load());

  // Per-wallet first-run init: grab the current latest tx so we don't
  // flood the group with historical activity.
  //
  // We do NOT process.exit on init failure — that would put pm2 in a
  // tight restart loop during a Moralis outage. Instead we initialize
  // only the endpoints that aren't already seeded, leave failures as
  // null, and let the normal tick path retry next cycle. (sliceNew
  // returns [] for a null lastSeen, so no historical flood when it
  // recovers.)
  for (const wallet of WALLETS) {
    const key = wallet.address;
    if (!state[key]) state[key] = { bnb: null, bep20: null };

    const needsBnb   = !state[key].bnb;
    const needsBep20 = !state[key].bep20;
    if (!needsBnb && !needsBep20) continue;

    console.log(`Initializing lastSeen for ${wallet.label} (${wallet.address})`);

    const [nativeRes, tokensRes] = await Promise.allSettled([
      needsBnb   ? getNativeTransactions(wallet.address, 1) : Promise.resolve(null),
      needsBep20 ? getTokenTransactions(wallet.address, 1)  : Promise.resolve(null),
    ]);

    if (needsBnb) {
      if (nativeRes.status === 'fulfilled') {
        state[key].bnb = nativeRes.value[0]?.hash || null;
      } else {
        console.warn(
          `⚠️  ${wallet.label} BNB init failed: ${nativeRes.reason.message} — will retry next tick`
        );
      }
    }
    if (needsBep20) {
      if (tokensRes.status === 'fulfilled') {
        state[key].bep20 = tokensRes.value[0]?.hash || null;
      } else {
        console.warn(
          `⚠️  ${wallet.label} BEP-20 init failed: ${tokensRes.reason.message} — will retry next tick`
        );
      }
    }
    console.log(`  Initialized: ${JSON.stringify(state[key])}`);
  }
  lastSeenStore.save(state);

  const walletsList = WALLETS.map((w) => `\`${mdEscape(w.label)}\``).join(', ');
  await notify(
    `🤖 *BSC Notifier online*\n` +
    `Watching ${WALLETS.length} wallet(s): ${walletsList}\n` +
    `Poll: every ${POLL_INTERVAL_MS / 1000}s.`
  );

  // Tick-sleep-tick forever. Errors inside tick() are caught so the
  // schedule keeps running.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const n = await tick(state);
      const stamp = new Date().toLocaleTimeString();
      console.log(`[${stamp}] tick complete — ${n} new tx(s) across ${WALLETS.length} wallet(s).`);
    } catch (err) {
      console.error('⚠️  Tick failed:', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
})();

// --- Graceful shutdown ---------------------------------------------
// SIGINT  → Ctrl+C and pm2's default stop signal
// SIGTERM → systemd / OS shutdown / container stop
function shutdown(reason) {
  console.log(`\n👋 Shutting down (${reason}).`);
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
