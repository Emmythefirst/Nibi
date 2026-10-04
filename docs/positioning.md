# Positioning: Nibi vs. the rest of the field

## Landscape

| | Settlement | Finality model | Replay/idempotency | Discovery Sybil resistance | Standardization |
|---|---|---|---|---|---|
| **x402 (Base/Coinbase)** | USDC | Probabilistic (chain confirmations) | Bearer token, no resource binding — broken in practice | None documented | x402 Foundation (broad) |
| **x402 (Solana)** | USDC-SPL | Probabilistic (sub-second, still probabilistic) | Same reference design, same gap | None documented | Same standard |
| **Beep (Sui)** | USDC | Probabilistic (Sui parallel execution) | Not documented | Not documented | Compatible with MCP/A2A/AP2 |
| **L402 (Lightning)** | Sats | Local cryptographic verification, stateless | Solved by design (preimage is single-use) | N/A (no discovery layer defined) | None (Bitcoin-only, no foundation backing) |
| **Nibi (Tachi)** | Native sats via VTXO | Cooperative co-signing (near-immediate, not probabilistic) + HAT/RIP for independent verification | Resource-bound Obol commitment (L402-style binding, x402-style transport) | TAURUS-bonded registry (stake-weighted) | x402-shaped transport, Tachi-native settlement |

L402 has the right security properties but no ecosystem reach. x402 has the ecosystem reach but a broken reference implementation running on an asset a third party (Circle) can freeze. Nibi is the attempt to get both — x402's shape and legibility, L402's cryptographic discipline, on an asset nobody can freeze.

## The five attacks, and Nibi's mitigation

Source: "Five Attacks on x402 Payment Protocol," arXiv 2605.11781.

1. **Revert-grant under optimistic execution** — reference x402 can grant access before finality; a reorg means unpaid access (5% under honest conditions, 100% with a malicious facilitator in the paper's tests). Nibi gates access on the cooperative co-signature actually completing, which is near-immediate rather than probabilistic, with HAT/RIP available as an independently-checkable proof rather than trusting a facilitator's word.
2. **Replay / idempotency failure** — `X-PAYMENT` is a bearer token with no binding to a specific request; the paper reproduced 248+ duplicate grants from one captured payment. Nibi's commitment hash binds a payment to one exact `resource_path + payment_id + price + expiry`, and the server enforces single-use `payment_id` atomically (`ObolRegistry`).
3. **HTTP/proxy/CDN leakage** — payment-gated content is cacheable by default in the reference design. Nibi's server middleware sets `Cache-Control: no-store` on every protected route, not as an opt-in.
4. **Discovery-layer Sybil manipulation** — free-to-register listings let fake endpoints capture majority traffic in the paper's simulation. Nibi's registry has two tiers: registering is still free (a Sybil can still list itself), but a *verified* listing requires proving control of a real TAURUS vault via a signed challenge, with the bonded amount independently re-derived from the real Bitcoin L1 output — not a number the service claims. Verified listings always outrank unverified ones regardless of any claimed bond size, which is the actual fix: the paper's finding was that a fake listing could buy priority for free, and now it structurally cannot, no matter what number it claims. See `packages/core/src/bondProof.ts` and `npm run test:registry`.
5. **Settlement preemption** — an open, permissionless settlement path lets a third party front-run and consume a payment authorization. Cooperative co-signing requires the Tachi node as counterparty to every settlement, which is structurally harder to front-run than an open mempool signature.

## What's proven vs. what's a hypothesis — be precise about this

Mitigations 2 and 3 are implemented and testable today (see `npm run test:protocol` and `npm run test:e2e` in the repo root) — they don't depend on anything Tachi hasn't published yet. Mitigations 1 and 5 depend on how Tachi's real cooperative co-signing behaves under adversarial conditions, which hasn't been verified against real infrastructure. **Do not present #5 in particular as a settled, proven property** — it's a structural argument, not a tested result, until it's actually been checked against real mechanics.

## Interoperability — the claim to get right

Nibi reuses x402's request/response *contract*: HTTP 402, a JSON challenge, a payment header, a retry. That much really is recognizable to anyone who knows x402. It is **not** a drop-in for existing x402 clients. The spec's `accepts` array is designed to let a server list multiple payment schemes, but no BTC settlement scheme has been registered or implemented anywhere in the wild x402 ecosystem — an agent running Coinbase's off-the-shelf `x402-fetch` client would receive Nibi's 402 response, see a scheme it doesn't recognize, and be unable to complete the payment. Only an agent running Nibi's own client SDK can pay a Nibi-protected endpoint today. The honest, still-strong claim: same contract, a genuinely Bitcoin-native scheme, and a credible path to registering that scheme with the broader ecosystem later — not "works with any x402 agent out of the box."
