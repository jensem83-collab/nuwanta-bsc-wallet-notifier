// testBscscan.js
// ------------------------------------------------------------------
// Quick sanity check for Phase 2.
// Run with:  node testBscscan.js
// Prints the 5 most recent transactions (BNB + BEP-20 combined).
// ------------------------------------------------------------------

require('dotenv').config();
const { getAllRecentTransactions } = require('./bscscan');

(async () => {
  const wallet = process.env.WALLET_ADDRESS;

  console.log('--------------------------------------------------');
  console.log(' BSC Wallet Notifier — Phase 2 test');
  console.log('--------------------------------------------------');
  console.log(' Wallet :', wallet);
  console.log(' Fetching last 5 transactions...');
  console.log('--------------------------------------------------');

  try {
    const txs = await getAllRecentTransactions(wallet, 5);

    if (txs.length === 0) {
      console.log('No transactions found for this wallet.');
      return;
    }

    txs.forEach((tx, i) => {
      console.log(`\n[${i + 1}] ${tx.type} transaction`);
      console.log(`    Value  : ${tx.value}`);
      console.log(`    From   : ${tx.from}`);
      console.log(`    To     : ${tx.to}`);
      console.log(`    When   : ${tx.timestamp}`);
      console.log(`    Hash   : ${tx.hash}`);
      console.log(`    View   : https://bscscan.com/tx/${tx.hash}`);
    });

    console.log(`\n✅ Success — fetched ${txs.length} transaction(s).`);
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error('\nCommon causes:');
    console.error('  - MORALIS_API_KEY missing or wrong in .env');
    console.error('  - WALLET_ADDRESS / WALLET_ADDRESSES missing or malformed in .env');
    console.error('  - Network blocked or Moralis temporarily down');
    process.exit(1);
  }
})();
