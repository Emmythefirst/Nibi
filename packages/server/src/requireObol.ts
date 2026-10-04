import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { buildCommitmentHash, fromBase64 } from "@nibi/core";
import type { PaymentChallenge, ObolReceipt, TaurusAdapter } from "@nibi/core";
import { ObolRegistry } from "./registry.js";

export interface RequireObolOptions {
  priceSats: number;
  payTo: string;
  adapter: TaurusAdapter;
  registry: ObolRegistry;
  challengeTtlMs?: number;
}

/**
 * Express middleware that turns a route into a Nibi-protected, pay-per-
 * request endpoint. Implements the server side of the Obol flow described
 * in the project briefing:
 *
 *   1. No X-OBOL header -> issue a fresh 402 challenge with a commitment
 *      hash binding it to this exact request, and remember it as pending.
 *   2. X-OBOL header present -> look up the pending challenge it claims to
 *      redeem, verify the commitment hash matches, verify the cooperative
 *      signature actually settled, then mark it redeemed exactly once.
 *
 * The `Cache-Control: no-store` header is set unconditionally, closing
 * Attack III (HTTP/proxy/CDN leakage of paid content) by default rather
 * than as something a server author has to remember to opt into.
 */
export function requireObol(opts: RequireObolOptions) {
  const ttl = opts.challengeTtlMs ?? 60_000;

  return async function requireObolMiddleware(req: Request, res: Response, next: NextFunction) {
    res.setHeader("Cache-Control", "no-store");

    const obolHeader = req.header("X-OBOL");

    if (!obolHeader) {
      const paymentId = randomUUID();
      const expiresAt = Date.now() + ttl;
      const resourcePath = req.originalUrl;
      const commitmentHash = await buildCommitmentHash({
        resourcePath,
        paymentId,
        priceSats: opts.priceSats,
        expiresAt,
      });
      const challenge: PaymentChallenge = {
        resourcePath,
        paymentId,
        priceSats: opts.priceSats,
        expiresAt,
        commitmentHash,
        payTo: opts.payTo,
      };
      opts.registry.savePending(challenge);
      res.status(402).json(challenge);
      return;
    }

    let receipt: ObolReceipt;
    try {
      receipt = fromBase64<ObolReceipt>(obolHeader);
    } catch {
      res.status(400).json({ error: "Malformed X-OBOL header" });
      return;
    }

    // Attack II mitigation: the payment_id must point at a challenge THIS
    // server actually issued and hasn't already redeemed. A replayed
    // header points at a paymentId that's either unknown or already
    // consumed, and gets rejected here, every time.
    const original = opts.registry.getPending(receipt.paymentId);
    if (!original) {
      res.status(409).json({
        error: "Unknown or already-redeemed payment_id. Replayed or forged X-OBOL headers are rejected.",
      });
      return;
    }

    if (original.commitmentHash !== receipt.commitmentHash) {
      res.status(400).json({ error: "Commitment hash does not match the issued challenge." });
      return;
    }

    if (Date.now() > original.expiresAt) {
      opts.registry.markRedeemed(receipt.paymentId); // burn it either way, don't leave it redeemable
      res.status(410).json({ error: "Payment challenge expired." });
      return;
    }

    // Attack I mitigation: gate access on the cooperative signature actually
    // verifying, rather than optimistically trusting a submitted payment.
    const valid = await opts.adapter.verifyCosignature({
      cosignature: receipt.cosignature,
      payTo: original.payTo,
      amountSats: original.priceSats,
      commitmentHash: original.commitmentHash,
    });

    if (!valid) {
      res.status(402).json({ error: "Cooperative settlement could not be verified." });
      return;
    }

    opts.registry.markRedeemed(receipt.paymentId);
    res.setHeader(
      "X-OBOL-RESPONSE",
      JSON.stringify({
        paymentId: receipt.paymentId,
        settledAt: receipt.settledAt,
        daemonReachable: receipt.daemonReachable,
      })
    );
    next();
  };
}
