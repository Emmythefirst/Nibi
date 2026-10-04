import express from "express";
import cors from "cors";
import { requireObol, ObolRegistry } from "@nibi/server";
import { createMockTaurusAdapter, registerVerifiedBond, type RealVaultFixture } from "@nibi/core";

/**
 * "Agent B" — a second, independent autonomous party, not just another
 * route on the same API. It's the counterparty in the agent-to-agent demo:
 * the main demo agent pays THIS process for a sub-task, over the same
 * Nibi protocol it uses to pay the plain demo-api service. The SDK doesn't
 * distinguish agent-to-service from agent-to-agent — the distinction only
 * exists in which process is on the other end, which is exactly the point.
 */
const app = express();
// See apps/demo-api/src/server.ts for why exposedHeaders is required here.
app.use(cors({ exposedHeaders: ["X-OBOL-RESPONSE"] }));

const adapter = createMockTaurusAdapter();
const registry = new ObolRegistry();

const PRICE_SATS = 10;
const PAY_TO = "tachi1demo-agent-b-vault-address";
const SERVICE_ID = "nibi-agent-b-factcheck";

// A real vault this project generated, funded via Tachi's real faucet, and
// registered on Tachi's real ledger (scripts/real-sdk-register-vault-test.ts,
// see PROGRESS.md for the full trail). Fixed/reused rather than regenerated
// on every restart — registering a fresh vault takes a real ~15-20min
// faucet-confirmation cycle. Used below to prove Agent B's registry bond
// cryptographically instead of self-reporting a bare number.
const VAULT_A_FIXTURE: RealVaultFixture = {
  mnemonic:
    "order manage onion this million action scorpion gauge estate artefact panel suit spatial excuse enemy slab pipe pair million lizard real blossom dwarf brand",
  vaultAddress: "bcrt1phg6qz6cnrd8f0rpudhpxl2l8r34556xuepqafrgc2tmuuydny4pqkdzh44",
  fundingTxid: "cdd926bc407ce6998df58b3266d19267445d889b3fa892b6f3ed1f335fce3fa2",
  fundingVout: 0,
};

app.get(
  "/api/fact-check",
  requireObol({ priceSats: PRICE_SATS, payTo: PAY_TO, adapter, registry }),
  (_req, res) => {
    res.json({
      fact: pickFact(),
      verifiedBy: "agent-b",
      priceSats: PRICE_SATS,
    });
  }
);

app.get("/health", (_req, res) => res.json({ ok: true }));

function pickFact(): string {
  const facts = [
    "Tachi's TAURUS vaults rely on on-chain timelocks, not a federation, for unilateral exit.",
    "VTXOs settle off-chain but remain redeemable on-chain at any time.",
    "HAT/RIP proofs let a third party verify off-chain state against Bitcoin without trusting an operator.",
    "Cooperative co-signing settles a VTXO transfer without waiting on probabilistic chain confirmations.",
  ];
  return facts[Math.floor(Math.random() * facts.length)];
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4403;
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:4402/registry/services";

app.listen(PORT, () => {
  console.log(`Agent B (fact-check) listening on http://localhost:${PORT}`);
  console.log(`Protected endpoint: GET /api/fact-check (${PRICE_SATS} sats)`);
  void registerSelfWithRegistry();
});

// Best-effort: Agent B bonds itself into the shared registry on startup,
// same as any independent service would. Non-fatal if demo-api isn't up
// yet or isn't running at all — this process still works standalone.
//
// Real challenge -> sign -> verify round trip (see @nibi/core's bondClient.ts
// and bondProof.ts) — demo-api independently confirms VAULT_A_FIXTURE is a
// real, registered vault Agent B actually controls, and re-derives the
// bonded amount from the real Bitcoin L1 output. Not a self-reported number.
async function registerSelfWithRegistry() {
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const registryBaseUrl = REGISTRY_URL.replace(/\/registry\/services$/, "");
    const result = await registerVerifiedBond({
      registryUrl: registryBaseUrl,
      serviceId: SERVICE_ID,
      fixture: VAULT_A_FIXTURE,
    });
    if (result.ok) {
      console.log(`Registered with the shared registry at ${registryBaseUrl} — real, cryptographically verified bond.`);
    } else {
      console.warn(`Could not verify bond with the shared registry: ${result.error}`);
    }
  } catch (err) {
    console.warn(
      `Could not reach the shared registry at ${REGISTRY_URL} — start apps/demo-api first if you want Agent B listed.`,
      (err as Error).message
    );
  }
}
