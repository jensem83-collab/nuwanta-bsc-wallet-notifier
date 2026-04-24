// =====================================================================
// getChatId.js  —  one-time helper to find your Telegram group chat ID
// =====================================================================
// HOW TO USE:
//   1. Make sure your bot is ADDED to the Telegram group (as a member).
//   2. In @BotFather -> /mybots -> your bot -> Bot Settings ->
//      Group Privacy -> turn OFF. (Lets the bot read all group messages.)
//   3. Run:   npm run get-chat-id
//   4. Send any message in the group ("hello" works).
//   5. Copy the printed Chat ID (keep the minus sign) into .env as
//      TELEGRAM_CHAT_ID.
//   6. Stop this script with Ctrl+C.
// =====================================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

// Guard clause: fail fast if the token is missing — gives a clear error
// instead of a confusing crash deep inside the library.
if (!token || token === 'your_new_bot_token_here') {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing or still the placeholder.');
  console.error('   Open .env and paste your real bot token from BotFather.');
  process.exit(1);
}

// polling: true = the bot actively asks Telegram "any new messages?"
// This is the simplest mode — no webhook server needed.
const bot = new TelegramBot(token, { polling: true });

console.log('✅ Bot is listening.');
console.log('   Now go to your Telegram group and send any message...');
console.log('   (Press Ctrl+C to stop when you have the chat ID.)\n');

// Every time the bot sees a message, we print the chat info.
bot.on('message', (msg) => {
  console.log('------------------------------');
  console.log('Chat title:', msg.chat.title || '(private chat)');
  console.log('Chat type: ', msg.chat.type); // 'group', 'supergroup', 'private'
  console.log('Chat ID:   ', msg.chat.id);   // ← THIS is what you need
  console.log('From:      ', msg.from.username || msg.from.first_name);
  console.log('Message:   ', msg.text);
  console.log('------------------------------\n');
});

// If polling itself errors (bad token, network), show a friendly message.
bot.on('polling_error', (err) => {
  console.error('⚠️  Polling error:', err.message);
  console.error('   Most common cause: invalid TELEGRAM_BOT_TOKEN.');
});
