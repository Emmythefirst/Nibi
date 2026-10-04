import * as bitcoin from "bitcoinjs-lib";
import { BitcoinCoreRpcClient, WalletAggregator, Keystore, getNetwork } from "@tachibtc/taurus-wallet-aggregator";
import {
  createVault,
  verifyVaultP2tr,
  depositToVault,
  buildTachiTxDeposit,
  signTachiTx,
  broadcastTachiTx,
  vtxoIdFromDeposit,
  waitForVtxoCommit,
  getVtxo,
  getAccountNonce,
  registerVault,
  toXOnly,
  type TaprootSigner,
} from "@tachibtc/taurus-vault-core";

/**
 * Completes what scripts/real-sdk-fresh-vault-test.ts deliberately left undone
 * (see its "Next step" note, and PROGRESS.md): our earlier real deposit only
 * ever put funds on the Bitcoin L1 layer. Tachi's own ledger (the thing
 * `/tachi_tx` and the HAT-proof endpoint actually index) doesn't know a vault
 * exists until it's separately REGISTERED — `registerVault` (a `TxVaultOpen`
 * ledger message). That, in turn, needs at least one ledger-native VTXO
 * already under the account to pay its (here, zero) open fee — which itself
 * requires a prior `TxDeposit` ledger message. So the real, documented order
 * is: fund L1 -> TxDeposit (ledger credit) -> TxVaultOpen (registerVault).
 *
 * Every step here uses the real SDK against the real daemon, nothing mocked.
 * The TaprootSigner construction and the TxDeposit->vtxoId pattern are taken
 * directly from Tachi's own "First VTXO in 30 Minutes" quickstart
 * (docs.tachibtc.com/vtxo-quickstart) — quoted and confirmed working there,
 * not guessed. The `registerVault` outpoint/inputs/outputs wiring is NOT
 * documented with real example values anywhere Tachi publishes (confirmed by
 * checking directly) — that part is assembled from the compiled .d.ts types
 * in @tachibtc/taurus-vault-core, most importantly by reading back the TRUE
 * committed VTXO amount via `getVtxo` after the TxDeposit commits, rather
 * than assuming what `feeSats` on a TxDeposit does to the credited amount.
 *
 * What this does NOT change, and won't, regardless of success: Tachi's own
 * HAT anchoring (btc_height/btc_timestamp) has shown 0 across every real
 * transaction on this network sampled so far (see PROGRESS.md /
 * hatProof.ts) — that's the daemon's own batch-anchoring process, unrelated
 * to vault registration, and outside anything a client can influence. And
 * this still says nothing about third-party payment cosigning, which Tachi
 * confirmed directly is a separate, still-unavailable capability.
 */

const DAEMON_URL = process.env.TACHI_DAEMON_URL ?? "https://rpc-regtest.tachibtc.com";
const FAUCET_URL = process.env.TACHI_FAUCET_URL ?? "https://faucet.tachibtc.com";
const FAUCET_AMOUNT_BTC = 0.001;
const DEPOSIT_SATS = 80_000n;
const LEDGER_CREDIT_SATS = 100_000n; // TxDeposit ledger credit, per Tachi's own quickstart example
const LEDGER_CREDIT_FEE_SATS = 2n; // ditto — matching known-working values rather than guessing
const VAULT_OPEN_FEE_SATS = 2n; // real minimum is 1 sat per /tachi_feeEstimate; 2 matches the daemon's "recommended" value
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 20 * 60_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("— Nibi vault registration test (real TxDeposit + real TxVaultOpen) —\n");

  console.log("1. Generating a brand new regtest wallet…");
  const rpc = new BitcoinCoreRpcClient({ url: DAEMON_URL });
  const { aggregator, mnemonic } = await WalletAggregator.createNew({ network: "regtest", rpc });
  console.log(`   mnemonic (regtest-only, throwaway): ${mnemonic}`);
  const userWallet = aggregator.addAccount({ addressType: "p2wpkh" });
  console.log(`   funding address: ${userWallet.receiveAddress}`);

  console.log("\n2. Checking faucet capacity…");
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
  if (faucetResult.dryRun) throw new Error("FAIL: faucet is in dry-run mode");

  console.log("\n4. Polling for faucet confirmation…");
  let confirmed = false;
  {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
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
  }
  if (!confirmed) {
    throw new Error(`FAIL: faucet funding not confirmed within ${POLL_TIMEOUT_MS / 1000}s — re-run later, the faucet tx is real and still pending.`);
  }

  console.log("\n5. Deriving vault and depositing real BTC into it…");
  const vault = await createVault({
    network: "regtest",
    userWallet,
    validators: { endpoint: `${DAEMON_URL}/tachi_validators` },
  });
  verifyVaultP2tr(vault.p2tr);
  console.log(`   vault address: ${vault.p2tr.address}`);

  const deposit = await depositToVault({ vault, userWallet, rpc, amountSats: DEPOSIT_SATS, feeRateSatVb: 2 });
  console.log(`   deposit txid: ${deposit.txid}`);
  console.log(`   amountSats: ${deposit.amountSats}  feeSats: ${deposit.feeSats}  changeSats: ${deposit.changeSats}`);

  console.log("\n6. Locating the vault's real output index in the deposit tx (not assumed to be 0)…");
  const decodedTx = bitcoin.Transaction.fromHex(deposit.rawTxHex);
  const vaultScript = bitcoin.address.toOutputScript(vault.p2tr.address, bitcoin.networks.regtest);
  const vaultVout = decodedTx.outs.findIndex((out) => Buffer.from(out.script).equals(Buffer.from(vaultScript)));
  if (vaultVout === -1) throw new Error("FAIL: could not find the vault's output in the deposit transaction");
  console.log(`   vault funding vout: ${vaultVout}`);

  console.log("\n7. Building a TaprootSigner from the same mnemonic (Tachi quickstart pattern)…");
  const keystore = Keystore.fromMnemonic(mnemonic, "", getNetwork("regtest"), "p2wpkh", 0);
  const node = keystore.signerFor(false, 0);
  const userSigner: TaprootSigner = {
    publicKey: Buffer.from(node.publicKey),
    sign: (h) => Buffer.from(node.sign(h)),
    signSchnorr: (h) => Buffer.from(node.signSchnorr!(h)),
  };
  const userXOnly = toXOnly(userSigner.publicKey);
  console.log(`   signer pubkey: ${userSigner.publicKey.toString("hex")}`);

  console.log("\n8. Onboarding a ledger-native VTXO (TxDeposit) — Tachi's ledger has to know about SOME");
  console.log("   spendable VTXO under this account before it will register a vault…");
  const depositNonce = await getAccountNonce(userSigner.publicKey, { baseUrl: DAEMON_URL });
  console.log(`   account nonce: ${depositNonce}`);
  const depositDraft = buildTachiTxDeposit({
    userXOnly: userSigner.publicKey,
    amountSats: LEDGER_CREDIT_SATS,
    nonce: depositNonce,
    feeSats: LEDGER_CREDIT_FEE_SATS,
  });
  const signedDeposit = await signTachiTx(depositDraft, userSigner);
  await broadcastTachiTx(signedDeposit, { url: `${DAEMON_URL}/tachi_txBroadcastSync` });
  const vtxoId = vtxoIdFromDeposit(signedDeposit, 0);
  console.log(`   ledger TxDeposit broadcast, vtxoId: ${vtxoId.toString("hex")}`);
  await waitForVtxoCommit(vtxoId, { baseUrl: DAEMON_URL, overallTimeoutMs: 90_000, pollIntervalMs: 2_000 });
  console.log("   committed.");

  console.log("\n9. Reading back the TRUE committed VTXO amount (not assuming what feeSats did to it)…");
  const vtxoRecord = await getVtxo(vtxoId, { baseUrl: DAEMON_URL });
  console.log(`   ledger VTXO amountSats: ${vtxoRecord.amountSats}`);

  console.log("\n10. Registering the vault with the daemon (TxVaultOpen)…");
  // The SDK's own doc comment calls feeSats "commonly 0n" for a vault open —
  // the live daemon disagrees: feeSats: 0n was rejected with "fee below
  // minimum" (tendermint code 8). GET /tachi_feeEstimate reports the real
  // minimum (1 sat) rather than guessing; VAULT_OPEN_FEE_SATS pays the
  // recommended 2 sats and is subtracted from the change output so the
  // ledger balance (inputs - outputs === feeSats) still holds.
  const fundingTxid = Buffer.from(deposit.txid, "hex").reverse();
  const reg = await registerVault({
    vault,
    outpoint: { fundingTxid, fundingVout: vaultVout },
    userSigner,
    inputs: [{ vtxoId }],
    outputs: [{ owner: userXOnly, amount: vtxoRecord.amountSats - VAULT_OPEN_FEE_SATS }],
    feeSats: VAULT_OPEN_FEE_SATS,
    broadcast: { url: `${DAEMON_URL}/tachi_txBroadcastSync` },
    account: { baseUrl: DAEMON_URL },
    confirm: { baseUrl: DAEMON_URL, overallTimeoutMs: 90_000, pollIntervalMs: 2_000 },
  });
  console.log(`   vaultId: ${reg.vaultIdHex}`);
  console.log(`   TxVaultOpen tx hash: ${reg.broadcast.tendermintTxHash ?? "(see reg.broadcast)"}`);
  console.log(`   commit status: ${JSON.stringify(reg.commit, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);

  console.log("\n— Result —");
  console.log("A freshly generated, self-funded vault was registered with Tachi's real ledger end to end:");
  console.log("new mnemonic -> real faucet -> real L1 deposit -> real ledger TxDeposit -> real TxVaultOpen.");
  console.log(`L1 deposit txid:  ${deposit.txid}`);
  console.log(`Vault address:    ${vault.p2tr.address}`);
  console.log(`Vault ID:         ${reg.vaultIdHex}`);
  console.log(`\nVerify independently: GET ${DAEMON_URL}/tachi_listVaults`);
  console.log(`Fetch the HAT proof for the TxVaultOpen commit hash once you have it from reg.broadcast/commit.`);

  aggregator.lock();
}

main().catch((err) => {
  console.error("\nVault registration test FAILED:", err);
  process.exit(1);
});
