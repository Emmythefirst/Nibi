import { TachiClient } from "@tachibtc/tachi-sdk-ts";
import { BitcoinCoreRpcClient, WalletAggregator } from "@tachibtc/taurus-wallet-aggregator";
import { createVault, verifyVaultP2tr } from "@tachibtc/taurus-vault-core";

/**
 * Proof that the REAL Tachi SDKs work — not the mock. Deliberately kept
 * separate from the live demo (apps/demo-api, apps/demo-agent, apps/agent-b)
 * rather than wired into it, because what this script can prove and what
 * the demo needs are two different things:
 *
 * - This script proves: the daemon is live, a real BIP-341 Taproot vault
 *   address can be derived from a real quorum, and the derivation is
 *   internally consistent (verifyVaultP2tr re-checks it).
 * - It deliberately does NOT prove: that a payment can be sent and
 *   settled. Funding this vault needs Bitcoin Core wallet RPCs
 *   (sendtoaddress / generatetoaddress) that the public regtest endpoint
 *   returns "method not permitted" for without a Tachi API key, and even a
 *   funded vault can't pay a THIRD PARTY without the 5-of-7 KDHT quorum's
 *   cooperative signature, which for a plain transfer (not a refund of
 *   your own balance) is only ever gossiped over libp2p between node
 *   operators — no public HTTP RPC exists for it. See the long comment at
 *   the top of packages/core/src/taurusAdapter.ts for the full citation
 *   trail (SDK type declarations + docs.tachibtc.com, not a guess).
 *
 * Wiring a real vault address into the live demo as `payTo` without being
 * able to actually settle into it would look more real than it is —
 * exactly what this project's own positioning doc (docs/positioning.md)
 * says not to do. Keeping proof-of-real-integration separate from the
 * demo path is the honest way to show both: real SDK work happened, and
 * the live demo isn't overclaiming what it settles.
 */

const DAEMON_URL = process.env.TACHI_DAEMON_URL ?? "https://rpc-regtest.tachibtc.com";
const REGTEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function main() {
  console.log("— Nibi real Tachi SDK smoke test (live regtest, no mock) —\n");
  console.log(`Daemon: ${DAEMON_URL}\n`);

  console.log("1. DAEMON RPC — real network calls");
  const daemon = new TachiClient({ baseUrl: DAEMON_URL });
  const health = await daemon.getHealth();
  console.log(`   getHealth() -> status=${health.status} validators=${health.validators}`);
  const { validators } = await daemon.getValidators();
  console.log(`   getValidators() -> ${validators.length} known validators`);
  if (validators.length === 0) {
    throw new Error("FAIL: expected at least one real validator from the live daemon");
  }

  console.log("\n2. Real BIP-341 Taproot vault derivation (createVault + verifyVaultP2tr)");
  const rpc = new BitcoinCoreRpcClient({ url: DAEMON_URL });
  const aggregator = WalletAggregator.fromMnemonic(REGTEST_MNEMONIC, { network: "regtest", rpc });
  const userWallet = aggregator.addAccount({ addressType: "p2wpkh" });
  console.log(`   Funding wallet address (unfunded, regtest test vector): ${userWallet.receiveAddress}`);

  const vault = await createVault({
    network: "regtest",
    userWallet,
    validators: { endpoint: `${DAEMON_URL}/tachi_validators` },
  });
  verifyVaultP2tr(vault.p2tr); // throws on any mismatch — this is the real cryptographic check
  console.log(`   Vault P2TR address (real, quorum-bound, deterministic): ${vault.p2tr.address}`);
  console.log("   verifyVaultP2tr() passed — the address re-derives byte-for-byte from its own params.");

  console.log("\n3. Real balance check (expected 0 — this vault has never been funded)");
  try {
    await userWallet.sync();
    const balance = userWallet.balance as unknown as Record<string, bigint>;
    console.log(
      `   wallet.balance -> confirmed=${balance.confirmed} unconfirmed=${balance.unconfirmed} total=${balance.total}`
    );
  } catch (err) {
    console.log(`   sync() failed (not fatal to this smoke test): ${(err as Error).message}`);
  }

  console.log("\n— What this proves —");
  console.log("Real daemon connectivity, real validator quorum, real vault cryptography: all confirmed.");
  console.log("What it does NOT prove — and nothing publicly available today can — is funding this vault");
  console.log("or completing a cooperative transfer to a third party. See taurusAdapter.ts for why.");

  aggregator.lock();
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err);
  process.exit(1);
});
