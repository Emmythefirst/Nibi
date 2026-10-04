import express from "express";
import cors from "cors";
import { BitcoinCoreRpcClient } from "@tachibtc/taurus-wallet-aggregator";
import { requireObol, ObolRegistry, BondedRegistry } from "@nibi/server";
import {
  createMockTaurusAdapter,
  createDaemonClient,
  fetchVaultProof,
  verifyBondSignature,
  verifyRealBondOnChain,
  registerVerifiedBond,
  type BondClaim,
  type RealVaultFixture,
} from "@nibi/core";

const app = express();
// exposedHeaders is required for CORS: X-OBOL-RESPONSE is sent either way,
// but browser JS can't read a custom response header cross-origin unless
// it's explicitly allow-listed here — without this, the dashboard's real
// daemon-reachability check silently never fires.
app.use(cors({ exposedHeaders: ["X-OBOL-RESPONSE"] }));
app.use(express.json());

const DAEMON_URL = process.env.TACHI_DAEMON_URL ?? "https://rpc-regtest.tachibtc.com";

// Real Tachi settlement swaps in here later — see packages/core/src/taurusAdapter.ts.
const adapter = createMockTaurusAdapter();
const registry = new ObolRegistry();

const PRICE_SATS = 25;
const PAY_TO = "tachi1demo-vault-address";
// Priced between DEMO_MANDATE.autoApproveUnderSats (50) and .maxSatsPerRequest
// (100) so the dashboard's confirmAboveThreshold/"Approve or Deny" UI —
// otherwise dead code, since neither of the other two demo actions is priced
// above the auto-approve threshold — is actually reachable and demoable.
const PREMIUM_PRICE_SATS = 75;

// Attack IV mitigation (Sybil-able discovery registries): this demo-api
// process also hosts the shared bonded-service registry, standing in for
// the "reference facilitator" role described in the project briefing.
//
// Two tiers, both real: register()/POST below is the original self-reported
// path (still used by the dashboard's "Simulate Sybil listing" button — a
// bare claim is a legitimate lowest tier, as long as it can never outrank a
// proven one). registerVerified(), via /registry/bond-challenge and
// /registry/services/verify below, is a REAL cryptographic bond proof: a
// signed challenge proves control of a vault's owner key, and the claimed
// amount is independently re-derived from the real Bitcoin L1 output — see
// @nibi/core's bondProof.ts for exactly what's checked and why. This demo
// process registers its own listing through that real path (below), using
// VAULT_B_FIXTURE — a real vault this project generated, funded via
// Tachi's faucet, and registered on Tachi's real ledger in this same
// session (scripts/real-sdk-register-vault-test.ts). Reused as a fixed
// fixture rather than regenerated on every restart because registering a
// fresh vault takes a real ~15-20min faucet-confirmation cycle — a bad
// dev-server restart experience, not a shortcut on the verification itself.
const bondedRegistry = new BondedRegistry();
const rpc = new BitcoinCoreRpcClient({ url: DAEMON_URL });

const VAULT_B_FIXTURE: RealVaultFixture = {
  mnemonic:
    "among nothing sense method random cupboard blanket injury result orphan era salmon grant monitor moment nothing blossom century nuclear strategy arrest measure never rival",
  vaultAddress: "bcrt1pngkrwfh5cgw2d0qjyr3kq55llcnrnwczjtr5y3cj02ufat8zc7gq6hlllj",
  fundingTxid: "8d3bb4a495cc514f830fab715966873890f7661afb65c77c785a1bd590f7bda2",
  fundingVout: 0,
};

app.get("/registry/services", (_req, res) => {
  res.json(bondedRegistry.list());
});

app.post("/registry/services", (req, res) => {
  const { serviceId, bondedSats } = req.body ?? {};
  if (typeof serviceId !== "string" || !serviceId.trim() || typeof bondedSats !== "number" || bondedSats < 0) {
    res.status(400).json({ error: "serviceId (non-empty string) and bondedSats (number >= 0) are required" });
    return;
  }
  bondedRegistry.register(serviceId.trim(), bondedSats);
  res.status(201).json(bondedRegistry.list());
});

app.get("/registry/bond-challenge", (req, res) => {
  const owner = String(req.query.owner ?? "");
  if (!owner) {
    res.status(400).json({ error: "owner (x-only pubkey hex) query param is required" });
    return;
  }
  res.json({ nonce: bondedRegistry.issueChallenge(owner) });
});

app.post("/registry/services/verify", async (req, res) => {
  const { serviceId, owner, nonce, signature, vaultAddress, fundingTxid, fundingVout } = req.body ?? {};
  if (
    typeof serviceId !== "string" ||
    !serviceId.trim() ||
    typeof owner !== "string" ||
    typeof nonce !== "string" ||
    typeof signature !== "string" ||
    typeof vaultAddress !== "string" ||
    typeof fundingTxid !== "string" ||
    typeof fundingVout !== "number"
  ) {
    res.status(400).json({
      error: "serviceId, owner, nonce, signature, vaultAddress, fundingTxid, fundingVout are all required",
    });
    return;
  }

  if (!bondedRegistry.consumeChallenge(nonce, owner)) {
    res.status(409).json({ error: "Unknown, already-used, or expired challenge nonce for this owner." });
    return;
  }

  const claim: BondClaim = { serviceId: serviceId.trim(), vaultAddress, fundingTxid, fundingVout };
  if (!verifyBondSignature(signature, nonce, claim, owner)) {
    res.status(401).json({ error: "Signature does not verify against the claimed owner key." });
    return;
  }

  const chainCheck = await verifyRealBondOnChain({ rpc, daemonUrl: DAEMON_URL, ownerXOnlyHex: owner, claim });
  if (!chainCheck.ok) {
    res.status(422).json({ error: chainCheck.error });
    return;
  }

  bondedRegistry.registerVerified(claim.serviceId, chainCheck.realBondedSats!, vaultAddress);
  res.status(201).json(bondedRegistry.list());
});

// Real HAT/RIP proof lookup (see packages/core/src/hatProof.ts). Server-side,
// not browser-side, so the dashboard never talks to the daemon directly.
//
// This is our own vault's real TxVaultOpen, registered end to end on Tachi's
// real ledger by scripts/real-sdk-register-vault-test.ts: fresh mnemonic ->
// real faucet -> real L1 deposit -> real ledger TxDeposit -> real
// registerVault. Independently confirmed via GET /tachi_listVaults and
// GET /tachi_tx?hat=true against the live daemon before wiring in here —
// see PROGRESS.md for the full trail (including the two real daemon
// behaviors that differ from Tachi's own docs, discovered getting this to
// work: registerVault rejects feeSats: 0n despite the SDK's own comment
// calling it "commonly 0", and bitcoinjs-lib's TxOutput.script is a plain
// Uint8Array, not a Buffer). btc_height/btc_timestamp will still read 0 —
// that's Tachi's own anchoring batch lagging network-wide (confirmed by
// sampling ~90 other real transactions), not something registering our own
// vault could change. Override with NIBI_VAULT_PROOF_TXID if this ages out
// of the daemon's retention window. This is the SAME vault as VAULT_B_FIXTURE
// above, reused for both purposes since it's already fully proven.
const daemon = createDaemonClient(DAEMON_URL);
const DEFAULT_VAULT_PROOF_TXID = "4F7251DCEC51611D8D751A21D452BC17260D785EE84E12FDFB0B857A5DFAD27E";
const VAULT_PROOF_TXID = process.env.NIBI_VAULT_PROOF_TXID ?? DEFAULT_VAULT_PROOF_TXID;

app.get("/registry/proof", async (_req, res) => {
  if (!VAULT_PROOF_TXID) {
    res.status(404).json({ error: "No vault proof txid configured (NIBI_VAULT_PROOF_TXID)." });
    return;
  }
  const proof = await fetchVaultProof(daemon, VAULT_PROOF_TXID);
  res.json(proof);
});

app.get(
  "/api/insight",
  requireObol({ priceSats: PRICE_SATS, payTo: PAY_TO, adapter, registry }),
  (_req, res) => {
    res.json({
      insight: pickInsight(),
      generatedAt: new Date().toISOString(),
      priceSats: PRICE_SATS,
    });
  }
);

app.get(
  "/api/premium-insight",
  requireObol({ priceSats: PREMIUM_PRICE_SATS, payTo: PAY_TO, adapter, registry }),
  (_req, res) => {
    res.json({
      insight: pickPremiumInsight(),
      generatedAt: new Date().toISOString(),
      priceSats: PREMIUM_PRICE_SATS,
    });
  }
);

app.get("/health", (_req, res) => res.json({ ok: true }));

function pickInsight(): string {
  const insights = [
    "BTC dominance has been trending upward over the trailing 30 days.",
    "Mempool fee pressure is currently low — a good window for on-chain settlement.",
    "Off-chain payment volume on Tachi-style rails tends to spike during Asia trading hours.",
    "Sats-denominated microtransaction volume correlates with agent workload, not price.",
  ];
  return insights[Math.floor(Math.random() * insights.length)];
}

function pickPremiumInsight(): string {
  const insights = [
    "Cooperative co-signing settles a VTXO transfer without waiting on probabilistic chain confirmations.",
    "A TAURUS vault's cooperative leaf requires a 5-of-7 KDHT quorum; its exit leaf needs only a 1008-block timelock.",
    "HAT proofs anchor off-chain ledger state to a specific Bitcoin block height, once the daemon's batch process catches up.",
  ];
  return insights[Math.floor(Math.random() * insights.length)];
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4402;
app.listen(PORT, () => {
  console.log(`Nibi demo API listening on http://localhost:${PORT}`);
  console.log(`Protected endpoint: GET /api/insight (${PRICE_SATS} sats)`);
  console.log(`Bonded service registry: GET/POST /registry/services`);
  void registerOwnListing();
});

// Real challenge -> sign -> verify round trip against itself, over loopback
// HTTP — same code path an external service would use, not a shortcut.
async function registerOwnListing() {
  const result = await registerVerifiedBond({
    registryUrl: `http://localhost:${PORT}`,
    serviceId: "nibi-insight-api (this demo)",
    fixture: VAULT_B_FIXTURE,
  });
  if (result.ok) {
    console.log("Registered own listing with a REAL, cryptographically verified bond.");
  } else {
    console.warn(`Could not verify own bond on startup: ${result.error}`);
  }
}
