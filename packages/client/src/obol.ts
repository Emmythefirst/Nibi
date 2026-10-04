// @nibi/core/browser: @nibi/client can run in a browser (apps/demo-agent),
// so it must never pull in the full @nibi/core root — that also exports
// bondProof.ts/bondClient.ts, which need Node-only Tachi SDK signing code.
import { buildCommitmentHash } from "@nibi/core/browser";
import type { PaymentChallenge, ObolReceipt, TaurusAdapter } from "@nibi/core/browser";

/**
 * Pays a 402 challenge and returns the receipt to send back as the X-OBOL
 * header. Refuses to pay if the server's own commitment hash doesn't match
 * what we'd independently compute from the challenge fields — a tampered or
 * malformed challenge should never reach the point of moving sats.
 */
export async function payChallenge(challenge: PaymentChallenge, adapter: TaurusAdapter): Promise<ObolReceipt> {
  const expectedHash = await buildCommitmentHash({
    resourcePath: challenge.resourcePath,
    paymentId: challenge.paymentId,
    priceSats: challenge.priceSats,
    expiresAt: challenge.expiresAt,
  });

  if (expectedHash !== challenge.commitmentHash) {
    throw new Error("Nibi: commitment hash mismatch — refusing to pay a tampered or malformed challenge");
  }

  const { cosignature, settledAt, daemon } = await adapter.cooperativeSign({
    payTo: challenge.payTo,
    amountSats: challenge.priceSats,
    commitmentHash: challenge.commitmentHash,
  });

  return {
    paymentId: challenge.paymentId,
    commitmentHash: challenge.commitmentHash,
    cosignature,
    settledAt,
    daemonReachable: daemon.reachable,
  };
}
