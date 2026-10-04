import { BitcoinCoreRpcClient, WalletAggregator } from "@tachibtc/taurus-wallet-aggregator";
import { createVault, verifyVaultP2tr, depositToVault } from "@tachibtc/taurus-vault-core";

/**
 * The full real funding path, under our own control — not relying on funds
 * someone else left on Tachi's canonical quickstart mnemonic (that's what
 * real-sdk-deposit-test.ts found by accident). This script:
 *
 *   1. Generates a BRAND NEW mnemonic (WalletAggregator.createNew) — a vault
 *      nobody else has ever touched.
 *   2. Requests real regtest BTC from Tachi's public faucet
 *      (faucet.tachibtc.com), whose API (POST /api/faucet) isn't documented
 *      anywhere — reverse-engineered from the faucet web app's own JS
 *      bundle: `{ address, amountBtc }` -> `{ txid, dryRun }`. Confirmed
 *      against GET /api/faucet-status and /api/capacity first.
 *   3. Polls until the faucet tx actually confirms (regtest blocks land on
 *      their own schedule here — this is a shared chain we don't mine).
 *   4. Derives a real vault and deposits into it for real.
 *
 * This resolves blocker #1 from taurusAdapter.ts's file header (funding).
 * Blocker #2 (cosigning a transfer to a THIRD PARTY) is untouched by this
 * script on purpose — depositToVault only ever moves funds between
 * addresses this same mnemonic controls, so it doesn't need the KDHT
 * quorum at all. Tachi's own team confirmed on 2026-08-19 that a
 * client-facing transfer-cosign endpoint for third parties doesn't exist
 * yet — see PROGRESS.md.
 */

const DAEMON_URL = process.env.TACHI_DAEMON_URL ?? "https://rpc-regtest.tachibtc.com";
const FAUCET_URL = process.env.TACHI_FAUCET_URL ?? "https://faucet.tachibtc.com";
const FAUCET_AMOUNT_BTC = 0.001; // 100,000 sats — well under the 0.5 BTC/address cap
const DEPOSIT_SATS = 80_000n;
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 20 * 60_000; // this regtest chain mines roughly every ~10 minutes, not on demand

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("— Nibi fresh-vault real funding test (new mnemonic, real faucet, real deposit) —\n");

  console.log("1. Generating a brand new regtest wallet (no shared history)…");
  const rpc = new BitcoinCoreRpcClient({ url: DAEMON_URL });
  const { aggregator, mnemonic } = await WalletAggregator.createNew({ network: "regtest", rpc });
  console.log(`   mnemonic (regtest-only, throwaway): ${mnemonic}`);
  const userWallet = aggregator.addAccount({ addressType: "p2wpkh" });
  console.log(`   funding address: ${userWallet.receiveAddress}`);

  console.log("\n2. Checking faucet capacity for this address…");
  const capacityRes = await fetch(`${FAUCET_URL}/api/capacity?address=${encodeURIComponent(userWallet.receiveAddress)}`);
  const capacity = await capacityRes.json();
  console.log(`   ${JSON.stringify(capacity)}`);
  if (capacity.remaining < FAUCET_AMOUNT_BTC) {
    throw new Error(`FAIL: faucet capacity ${capacity.remaining} BTC is below the requested ${FAUCET_AMOUNT_BTC} BTC`);
  }

  console.log(`\n3. Requesting ${FAUCET_AMOUNT_BTC} BTC from the real faucet…`);
  const faucetRes = await fetch(`${FAUCET_URL}/api/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: userWallet.receiveAddress, amountBtc: FAUCET_AMOUNT_BTC }),
  });
  if (!faucetRes.ok) {
    throw new Error(`FAIL: faucet request failed — HTTP ${faucetRes.status}: ${await faucetRes.text()}`);
  }
  const faucetResult = await faucetRes.json();
  console.log(`   txid: ${faucetResult.txid}  dryRun: ${!!faucetResult.dryRun}`);
  if (faucetResult.dryRun) {
    throw new Error("FAIL: faucet is in dry-run mode — no real funds were sent");
  }

  console.log("\n4. Polling for confirmation (regtest blocks land on their own schedule here)…");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let confirmed = false;
  while (Date.now() < deadline) {
    await userWallet.sync();
    const balance = userWallet.balance as unknown as { confirmed: bigint };
    if (balance.confirmed > 0n) {
      console.log(`   confirmed balance: ${balance.confirmed} sats`);
      confirmed = true;
      break;
    }
    process.stdout.write(".");
    await delay(POLL_INTERVAL_MS);
  }
  if (!confirmed) {
    console.log(`\n   Not confirmed within ${POLL_TIMEOUT_MS / 1000}s. Faucet txid ${faucetResult.txid} is real and`);
    console.log(`   broadcast — verify later at ${DAEMON_URL}/tachi_tx?hash=${faucetResult.txid}, or re-run this`);
    console.log("   script once it lands (the funding step doesn't need repeating — just wait and check balance).");
    aggregator.lock();
    return;
  }

  console.log("\n5. Deriving vault and depositing for real…");
  const vault = await createVault({
    network: "regtest",
    userWallet,
    validators: { endpoint: `${DAEMON_URL}/tachi_validators` },
  });
  verifyVaultP2tr(vault.p2tr);
  console.log(`   vault address: ${vault.p2tr.address}`);

  const deposit = await depositToVault({
    vault,
    userWallet,
    rpc,
    amountSats: DEPOSIT_SATS,
    feeRateSatVb: 2,
  });
  console.log(`   deposit txid: ${deposit.txid}`);
  console.log(`   amountSats: ${deposit.amountSats}  feeSats: ${deposit.feeSats}  changeSats: ${deposit.changeSats}`);

  console.log("\n— Result —");
  console.log("A brand new mnemonic was generated, funded for real via Tachi's public faucet, and used to");
  console.log("deposit real regtest BTC into a real, freshly derived Tachi vault. Fully self-funded, no");
  console.log("reliance on funds left by earlier testers.");
  console.log(`Verify independently: GET ${DAEMON_URL}/tachi_tx?hash=${deposit.txid}`);

  aggregator.lock();
}

main().catch((err) => {
  console.error("\nFresh-vault test FAILED:", err);
  process.exit(1);
});
