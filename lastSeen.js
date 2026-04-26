// lastSeen.js
// ------------------------------------------------------------------
// Tiny helper to persist the "last processed tx hash" per endpoint
// across restarts. Stored as JSON on disk so we don't re-notify old
// transactions every time the bot restarts.
//
// File shape (lastSeen.json):
//   {
//     "bnb":   "0xabc...",   // latest native BNB tx hash we've processed
//     "bep20": "0x123..."    // latest BEP-20 transfer hash we've processed
//   }
//
// If the file is missing / empty / unreadable, we behave as if every
// key is unset — caller is expected to initialize on first run.
// ------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'lastSeen.json');

function load() {
  try {
    if (!fs.existsSync(FILE_PATH)) return {};
    const raw = fs.readFileSync(FILE_PATH, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    // Corrupt file: log and start fresh rather than crash.
    console.warn(`⚠️  lastSeen.json unreadable (${err.message}) — starting fresh.`);
    return {};
  }
}

function save(state) {
  // Atomic write: write to a sibling tmp file first, then rename. If
  // the process is killed mid-write, we either get the previous file
  // intact (rename never happened) or the new file complete (rename
  // is atomic on the same filesystem). No half-written JSON.
  const tmp = FILE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE_PATH);
}

module.exports = { load, save, FILE_PATH };
