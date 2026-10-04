/**
 * The Obol commitment hash — the thing that closes Attack II (replay /
 * idempotency failure) from "Five Attacks on x402 Payment Protocol"
 * (arXiv 2605.11781). A bare bearer token like x402's X-PAYMENT can be
 * replayed against any request; this hash binds a payment to one exact
 * resource, one payment_id, one price, and one expiry, so a captured
 * receipt is worthless anywhere else. Both client and server MUST compute
 * this identically — it lives here, in the shared package, specifically so
 * they can never drift apart.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildCommitmentHash(input: {
  resourcePath: string;
  paymentId: string;
  priceSats: number;
  expiresAt: number;
}): Promise<string> {
  const payload = `${input.resourcePath}|${input.paymentId}|${input.priceSats}|${input.expiresAt}`;
  return sha256Hex(payload);
}
