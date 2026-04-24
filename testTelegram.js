// =====================================================================
// testTelegram.js  —  sanity check that Phase 1 is fully wired up
// =====================================================================
// WHAT THIS DOES:
//   Sends a single "Bot online" message to your Telegram group.
//   If the message appears in the group, Phase 1 is COMPLETE and we
//   can safely move on to Phase 2 (BscScan integration).
//
// HOW TO USE:
//   1. Make sure .env has TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID filled.
//   2. Run:   npm run test-telegram
//   3. Check your Telegram group for the message.
// =====================================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// Validate both secrets are present before doing anything.
if (!token || token === 'your_new_bot_token_here') {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing in .env');
  process.exit(1);
}
if (!chatId) {
  console.error('❌ TELEGRAM_CHAT_ID is missing in .env');
  console.error('   Run `npm run get-chat-id` first to find it.');
  process.exit(1);
}

// polling: false = we only want to SEND a message, not listen. Faster + cleaner.
const bot = new TelegramBot(token, { polling: false });

const message =
  '🚀 *BSC Wallet Notifier is online!*\n\n' +
  'Phase 1 complete — Telegram connection works.\n' +
  'Next: BscScan integration (Phase 2).';

// sendMessage returns a Promise — we await it so we know if it succeeded.
bot
  .sendMessage(chatId, message, { parse_mode: 'Markdown' })
  .then(() => {
    console.log('✅ Test message sent successfully.');
    console.log('   Check your Telegram group now.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Failed to send message:', err.message);
    console.error('\nCommon causes:');
    console.error('  • Bot is not a member of the group');
    console.error('  • Chat ID is wrong (should start with "-" for groups)');
    console.error('  • Bot token is invalid');
    process.exit(1);
  });
