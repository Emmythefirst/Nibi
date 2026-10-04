/**
 * The 402 challenge a server issues before payment. Everything a client
 * needs to construct a valid, resource-bound payment lives here.
 */
export interface PaymentChallenge {
  resourcePath: string;
  paymentId: string;
  priceSats: number;
  expiresAt: number; // unix ms
  commitmentHash: string;
  payTo: string; // Tachi vault/address to pay
}

/**
 * What the client sends back (base64-encoded, in the X-OBOL header) as proof
 * of payment. commitmentHash ties this receipt to one specific challenge;
 * cosignature is the proof that Tachi's cooperative signing actually happened.
 */
export interface ObolReceipt {
  paymentId: string;
  commitmentHash: string;
  cosignature: string;
  settledAt: number;
  /**
   * Whether the real Tachi daemon was reachable when this payment settled —
   * a genuine network check (see daemonClient.ts), not simulated. The
   * cosignature itself is still a stand-in (see taurusAdapter.ts for why),
   * but this field is not: it's real proof the live Tachi network was up.
   */
  daemonReachable: boolean;
}

/**
 * A signed, scoped spending policy an agent operates under. The client SDK
 * enforces this BEFORE ever constructing a payment — mirrors the "Guardian
 * recommends, human confirms" boundary from Clavis, applied to payments
 * instead of vault exits.
 */
export interface SpendingMandate {
  maxSatsPerRequest: number;
  maxSatsPerWindow: number;
  windowMs: number;
  autoApproveUnderSats: number;
  allowedResources?: string[];
}

export interface MandateCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}
