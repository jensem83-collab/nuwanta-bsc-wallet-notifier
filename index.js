// =====================================================================
// index.js  —  MAIN BOT (Phase 3: poll + notify)
// =====================================================================
// WHAT THIS DOES
//   1. On startup: loads lastSeen.json (or initializes it from the
//      current latest tx, so we don't spam historical transactions).
//   2. Every POLL_INTERVAL_MS: fetches recent native + BEP-20 txs,
//      finds ones newer than what we've already seen, and sends each
//      new one to Telegram. Then updates lastSeen.json.
//   3. Errors on any single tick are logged — the loop keeps running.
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

// --- Config ----------------------------------------------------------
const TOKEN          = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID;
const WALLET         = process.env.WALLET_ADDRESS;
// Poll interval defaults to 60s. At 30s we burned through the Moralis
// free-tier compute-unit budget and got intermittent HTTP 500s. 60s
// cuts call rate in half with no functional downside for a human-
// readable notifier. Override via POLL_INTERVAL_SEC in .env if needed.
const POLL_INTERVAL_MS = (Number(process.env.POLL_INTERVAL_SEC) || 60) * 1000;
const FETCH_LIMIT      = 20;     // how many recent txs to pull per endpoint each tick.

// Skip transfers Moralis flagged as spam. Override by setting
// FILTER_SPAM=false in .env if you want to see every airdropped junk token.
const FILTER_SPAM = (process.env.FILTER_SPAM ?? 'true').toLowerCase() !== 'false';

// --- Startup validation ---------------------------------------------
// Fail fast with a clear message if .env is incomplete.
if (!TOKEN)   { console.error('❌ TELEGRAM_BOT_TOKEN missing in .env'); process.exit(1); }
if (!CHAT_ID) { console.error('❌ TELEGRAM_CHAT_ID missing in .env');   process.exit(1); }
if (!WALLET)  { console.error('❌ WALLET_ADDRESS missing in .env');     process.exit(1); }

// polling:false — we only SEND messages, never LISTEN. Keeps things simple.
const bot = new TelegramBot(TOKEN, { polling: false });

// --- Formatting helpers ---------------------------------------------

// Shorten an address/hash for the Telegram message (keeps it readable).
function short(str) {
  if (!str) return '(unknown)';
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

// Decide if the wallet was the sender or the receiver of this tx.
function direction(tx) {
  const me = WALLET.toLowerCase();
  if (tx.from?.toLowerCase() === me) return '📤 OUT';
  if (tx.to?.toLowerCase() === me)   return '📥 IN';
  return '↔️  OTHER';
}

// Build the Telegram message body for one tx. Markdown formatting.
function formatTx(tx) {
  const dir = direction(tx);
  const isOut = dir === '📤 OUT';
  const other = isOut ? tx.to : tx.from;

  // Show token name only if it adds info (different from symbol).
  const nameLine =
    tx.type === 'BEP20' && tx.tokenName && tx.tokenName !== tx.tokenSymbol
      ? `Token: ${tx.tokenName}\n`
      : '';

  // Quiet flag for spam if we ever choose to show it (FILTER_SPAM=false).
  const spamFlag = tx.possibleSpam ? '⚠️ *possible spam*\n' : '';

  return (
    `${dir}  *${tx.type}*\n` +
    spamFlag +
    `Amount: *${tx.value}*\n` +
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

// --- Core logic -----------------------------------------------------

// Given a list of txs (newest first) and a "last seen" hash, return
// ONLY the txs that came after that hash — in chronological order
// (oldest first), so notifications arrive in the right sequence.
function sliceNew(txsNewestFirst, lastSeenHash) {
  if (!lastSeenHash) return []; // no baseline yet; caller handles init.

  const idx = txsNewestFirst.findIndex((t) => t.hash === lastSeenHash);

  // Not found → either wallet is very busy (>FETCH_LIMIT new txs in one
  // tick and lastSeen fell off the window) or lastSeen was never in this
  // list. Safest: treat everything as new to avoid missing anything.
  const newOnes = idx === -1 ? txsNewestFirst : txsNewestFirst.slice(0, idx);

  return newOnes.reverse(); // chronological order for notifying.
}

// One polling cycle: fetch → diff → notify → persist.
async function tick(state) {
  // Promise.allSettled so a BEP-20 hiccup doesn't kill the BNB fetch
  // (or vice-versa). If one endpoint is down this tick, we still
  // process whatever the other returned, and we'll retry the failing
  // one next tick — lastSeen for that type just doesn't advance.
  const [nativeResult, tokensResult] = await Promise.allSettled([
    getNativeTransactions(WALLET, FETCH_LIMIT),
    getTokenTransactions(WALLET, FETCH_LIMIT),
  ]);

  if (nativeResult.status === 'rejected') {
    console.warn(`⚠️  BNB fetch failed: ${nativeResult.reason.message}`);
  }
  if (tokensResult.status === 'rejected') {
    console.warn(`⚠️  BEP-20 fetch failed: ${tokensResult.reason.message}`);
  }

  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : [];
  const tokens = tokensResult.status === 'fulfilled' ? tokensResult.value : [];

  const newNative = sliceNew(native, state.bnb);
  const newTokens = sliceNew(tokens, state.bep20);

  // Merge + sort chronologically so mixed-type alerts arrive in order.
  let newAll = [...newNative, ...newTokens].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  // Drop spam transfers (Moralis-flagged) unless FILTER_SPAM=false.
  if (FILTER_SPAM) {
    const before = newAll.length;
    newAll = newAll.filter((tx) => !tx.possibleSpam);
    const skipped = before - newAll.length;
    if (skipped > 0) console.log(`   (skipped ${skipped} spam transfer(s))`);
  }

  for (const tx of newAll) {
    console.log(`🔔 New ${tx.type} tx: ${tx.hash}`);
    await notify(formatTx(tx));
  }

  // Advance pointers to the NEWEST item we saw this tick (or keep the
  // old pointer if there were no txs of that type this tick).
  if (native.length) state.bnb   = native[0].hash;
  if (tokens.length) state.bep20 = tokens[0].hash;

  lastSeenStore.save(state);
  return newAll.length;
}

// --- Main loop ------------------------------------------------------
(async () => {
  console.log('--------------------------------------------------');
  console.log(' BSC Wallet Notifier — Phase 3');
  console.log(` Wallet  : ${WALLET}`);
  console.log(` Poll    : every ${POLL_INTERVAL_MS / 1000}s`);
  console.log('--------------------------------------------------');

  let state = lastSeenStore.load();

  // First run: initialize lastSeen from the CURRENT latest tx. This
  // prevents flooding the user with every historical tx on first start.
  if (!state.bnb || !state.bep20) {
    console.log('First run detected — initializing lastSeen from current chain state.');
    try {
      const [native, tokens] = await Promise.all([
        getNativeTransactions(WALLET, 1),
        getTokenTransactions(WALLET, 1),
      ]);
      state = {
        bnb:   native[0]?.hash   || null,
        bep20: tokens[0]?.hash   || null,
      };
      lastSeenStore.save(state);
      console.log('Initialized:', state);
    } catch (err) {
      console.error('❌ Failed to initialize lastSeen:', err.message);
      process.exit(1);
    }
  }

  await notify(
    `🤖 *BSC Notifier online*\nWatching \`${short(WALLET)}\`\nPolling every ${POLL_INTERVAL_MS / 1000}s.`
  );

  // The loop itself: run a tick, wait, repeat. Errors inside tick()
  // don't break the schedule — we just log and try again next time.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const n = await tick(state);
      const stamp = new Date().toLocaleTimeString();
      console.log(`[${stamp}] tick complete — ${n} new tx(s).`);
    } catch (err) {
      console.error('⚠️  Tick failed:', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
})();

// --- Graceful shutdown ---------------------------------------------
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down (Ctrl+C).');
  process.exit(0);
});
