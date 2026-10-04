import { randomBytes } from "node:crypto";
import type { PaymentChallenge } from "@nibi/core";

/**
 * The single-use enforcement that closes Attack II (replay/idempotency
 * failure). A challenge lives in `pending` from the moment it's issued
 * until it's redeemed exactly once; after that it moves to `redeemed` and
 * a second attempt with the same payment_id — a replayed X-OBOL header —
 * finds nothing pending and is rejected. This is in-memory for the
 * hackathon scaffold; swap for a real store (Redis, Postgres, etc.) before
 * running multiple server instances.
 */
export class ObolRegistry {
  private pending = new Map<string, PaymentChallenge>();
  private redeemed = new Set<string>();

  savePending(challenge: PaymentChallenge) {
    this.pending.set(challenge.paymentId, challenge);
  }

  getPending(paymentId: string): PaymentChallenge | undefined {
    return this.pending.get(paymentId);
  }

  isRedeemed(paymentId: string): boolean {
    return this.redeemed.has(paymentId);
  }

  markRedeemed(paymentId: string) {
    this.redeemed.add(paymentId);
    this.pending.delete(paymentId);
  }
}

export interface BondedListing {
  serviceId: string;
  bondedSats: number;
  registeredAt: number;
  /**
   * false = the old self-reported path (register()): a bare claim, ranked
   * only against other claims. true = registerVerified(): bondedSats was
   * independently re-derived from a real Bitcoin L1 output after a signed
   * challenge proved the registrant controls the vault's owner key — see
   * @nibi/core's bondProof.ts. Verified listings always outrank unverified
   * ones regardless of the claimed number (see list()) — this is what
   * closes the latent hole in the original design, where a Sybil could
   * simply self-report a huge fake number and outrank every real listing.
   */
  verified: boolean;
  vaultAddress?: string;
}

/**
 * The TAURUS-bonded discovery registry that mitigates Attack IV
 * (Sybil-able service discovery). Two tiers, both real code paths:
 *   - register(): the original self-reported path. Still here — it's what
 *     "Simulate Sybil listing" in the demo uses, and a bare claim is a
 *     legitimate lower tier (think: an unverified free listing) as long as
 *     it can never outrank a proven one.
 *   - issueChallenge()/consumeChallenge()/registerVerified(): a real
 *     challenge-response bond proof. The actual signature/chain
 *     verification lives in @nibi/core's bondProof.ts (needs daemon/RPC
 *     access this package deliberately doesn't depend on); this class only
 *     owns the nonce bookkeeping and the listing store.
 */
export class BondedRegistry {
  private listings = new Map<string, BondedListing>();
  private challenges = new Map<string, { ownerXOnlyHex: string; issuedAt: number }>();

  register(serviceId: string, bondedSats: number) {
    this.listings.set(serviceId, { serviceId, bondedSats, registeredAt: Date.now(), verified: false });
  }

  registerVerified(serviceId: string, bondedSats: number, vaultAddress: string) {
    this.listings.set(serviceId, {
      serviceId,
      bondedSats,
      registeredAt: Date.now(),
      verified: true,
      vaultAddress,
    });
  }

  issueChallenge(ownerXOnlyHex: string): string {
    const nonce = randomBytes(16).toString("hex");
    this.challenges.set(nonce, { ownerXOnlyHex, issuedAt: Date.now() });
    return nonce;
  }

  /** Single-use regardless of outcome — a nonce is consumed the moment it's checked, valid or not. */
  consumeChallenge(nonce: string, ownerXOnlyHex: string, ttlMs = 5 * 60_000): boolean {
    const entry = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    if (!entry) return false;
    if (entry.ownerXOnlyHex !== ownerXOnlyHex) return false;
    if (Date.now() - entry.issuedAt > ttlMs) return false;
    return true;
  }

  list(): BondedListing[] {
    return [...this.listings.values()].sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return b.bondedSats - a.bondedSats;
    });
  }
}
