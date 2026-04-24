# BSC Wallet Notifier

Monitor a Binance Smart Chain wallet and post Telegram alerts on new transactions.

---

## Phase 1 — Telegram Setup (you are here)

### 1. Install Node.js

If you don't have it yet, install the **LTS** version from https://nodejs.org
Check it works:
```bash
node -v
npm -v
```

### 2. Install dependencies

From inside the `bsc-wallet-notifier/` folder:
```bash
npm install
```

This reads `package.json` and downloads `axios`, `node-telegram-bot-api`, `dotenv`.

### 3. Create your `.env` file

Copy the template:
```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

Open `.env` in a text editor and paste your **new** bot token into `TELEGRAM_BOT_TOKEN`. Leave the other fields for now.

### 4. Prepare the Telegram group

- Add your bot to the target group (Group settings → Add member → search your bot's username).
- In @BotFather: `/mybots` → pick your bot → **Bot Settings** → **Group Privacy** → turn **OFF**. This lets the bot read messages so we can discover the chat ID.

### 5. Find the group chat ID

```bash
npm run get-chat-id
```

Send any message in the group. The terminal will print:
```
Chat ID: -1001234567890
```
Copy that value (keep the minus sign) into `.env` as `TELEGRAM_CHAT_ID`. Stop the script with `Ctrl+C`.

### 6. Send a test message

```bash
npm run test-telegram
```

If you see **🚀 BSC Wallet Notifier is online!** in your group, Phase 1 is complete. ✅

---

## What's next

- **Phase 2** — BscScan API integration (fetch wallet transactions)
- **Phase 3** — Combine: detect new transactions and notify Telegram
- **Phase 4** — Add BEP-20 token transfer detection
- **Phase 5** — Deploy to Railway so it runs 24/7
- **Phase 6** — Multi-wallet support, USD prices, polish

---

## Folder structure

```
bsc-wallet-notifier/
├── .env                ← your secrets (created from .env.example, NEVER commit)
├── .env.example        ← template
├── .gitignore          ← keeps .env out of git
├── package.json        ← project config + dependencies
├── getChatId.js        ← one-time helper to find group chat ID
├── testTelegram.js     ← sanity check: bot posts to the group
├── index.js            ← main bot (filled in during Phase 3)
└── README.md           ← this file
```

---

## Security notes

- `.env` is in `.gitignore` — it will never be pushed to GitHub.
- If a token ever leaks, immediately revoke via @BotFather → `/mybots` → Revoke current token.
- Don't paste real tokens into chat messages, screenshots, or issue trackers.
