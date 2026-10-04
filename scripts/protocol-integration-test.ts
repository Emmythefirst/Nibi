import { buildCommitmentHash, createMockTaurusAdapter } from "@nibi/core";
import { ObolRegistry } from "@nibi/server";

async function main() {
  console.log("— Nibi protocol integration test (in-process, no HTTP) —\n");

  const adapter = createMockTaurusAdapter();
  const registry = new ObolRegistry();

  const paymentId = "test-payment-1";
  const resourcePath = "/api/insight";
  const priceSats = 25;
  const expiresAt = Date.now() + 60_000;
  const payTo = "tachi1demo-vault-address";

  const commitmentHash = await buildCommitmentHash({ resourcePath, paymentId, priceSats, expiresAt });
  const challenge = { resourcePath, paymentId, priceSats, expiresAt, commitmentHash, payTo };
  registry.savePending(challenge);
  console.log("1. Challenge issued and stored as pending:", challenge.paymentId);

  const { cosignature, settledAt, daemon } = await adapter.cooperativeSign({
    payTo,
    amountSats: priceSats,
    commitmentHash,
  });
  console.log("2. Client cooperatively signed payment, cosignature:", cosignature.slice(0, 12) + "…");
  console.log(
    "   Real Tachi daemon reachable:",
    daemon.reachable,
    daemon.reachable ? `(${daemon.validators} validators)` : `(${daemon.error})`
  );

  const receipt = { paymentId, commitmentHash, cosignature, settledAt, daemonReachable: daemon.reachable };

  const original = registry.getPending(receipt.paymentId);
  if (!original) throw new Error("FAIL: challenge not found in registry");

  const valid = await adapter.verifyCosignature({
    cosignature: receipt.cosignature,
    payTo: original.payTo,
    amountSats: original.priceSats,
    commitmentHash: original.commitmentHash,
  });
  console.log("3. Server verified cosignature:", valid);
  if (!valid) throw new Error("FAIL: cosignature did not verify");

  registry.markRedeemed(receipt.paymentId);
  console.log("4. Payment marked redeemed. Access granted.\n");

  console.log("— Replay attempt —");
  const replayed = registry.getPending(receipt.paymentId);
  if (replayed) {
    throw new Error("FAIL: replayed payment_id should no longer be pending");
  }
  console.log("5. Replayed payment_id is no longer pending — a real server would reject with 409. PASS.\n");

  console.log("All protocol assertions passed.");
}

main().catch((err) => {
  console.error("Integration test FAILED:", err);
  process.exit(1);
});
