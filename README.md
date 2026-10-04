# Nibi

The first x402-shaped payment protocol that settles in native sats on Tachi — designed against the [five published attacks](https://arxiv.org/abs/2605.11781) on the x402 reference protocol, not just its happy path.

**Demo video:** [loom.com/share/305832e4a8aa491f9985f7b2c4348ffd](https://www.loom.com/share/305832e4a8aa491f9985f7b2c4348ffd)

Full design rationale, the attack-mitigation map, and honest scoping of what's proven vs. what's a hypothesis: see [`docs/positioning.md`](docs/positioning.md). For the complete build history, every real Tachi SDK finding, and every bug fixed along the way, see [`PROGRESS.md`](PROGRESS.md).

## Structure

- `packages/core` — shared types, the commitment-hash construction (the thing that binds a payment to one specific resource + request, closing the x402 replay attack), the Tachi daemon client, HAT-proof lookup, and the real cryptographic bond-proof protocol (`bondProof.ts`/`bondClient.ts`) used by the registry below. The per-payment cosignature in `taurusAdapter.ts` is still a deliberate, clearly-labeled stand-in — see "Current limitation" below for exactly why.
- `packages/client` — `NibiClient`, the agent-side SDK. Wraps `fetch`, handles the 402 challenge/pay/retry cycle, and enforces a signed Spending Mandate before it will ever construct a payment.
- `packages/server` — `requireObol` middleware for Express-style servers, the single-use payment registry that makes replaying a captured payment header fail, and `BondedRegistry` for the TAURUS-bonded service directory (two tiers: a free self-reported listing, and a real cryptographically-verified one — see below).
- `apps/demo-api` — a metered example API (`GET /api/insight`, 25 sats; `GET /api/premium-insight`, 75 sats — priced to trigger the mandate's confirm-threshold UI) protected by Nibi. Also hosts the shared bonded-service registry (`/registry/services`) and a real HAT-proof endpoint (`/registry/proof`) for its own registered vault, and registers its own listing on startup with a real, verified bond.
- `apps/agent-b` — a second, independent service (`GET /api/fact-check`, 10 sats/call) that plays the counterparty in the agent-to-agent demo, and registers into the shared registry on startup with its own real, verified bond (a different real vault than demo-api's).
- `apps/demo-agent` — the React dashboard shown in the demo video: live balance/spend, a mandate-window bar, an animated agent-to-service / agent-to-agent payment diagram, a spending-mandate confirmation prompt (Approve/Deny), a one-click "replay last payment" button demonstrating Attack II being blocked, a live registry panel showing verified vs. unverified listings, and a real HAT-proof panel for Nibi's own registered vault.

## Setup

```bash
npm install
```

## Verify the protocol logic directly (fastest check, no servers needed)

```bash
npm run test:protocol
```

Runs the challenge → pay → verify → replay-reject cycle in-process with no HTTP involved — confirms the core logic (commitment binding + single-use enforcement) is sound, and reports whether the real Tachi daemon was reachable.

## Verify the real Tachi SDK integration (live network calls, no mock)

```bash
npm run test:real-sdk               # real daemon queries + real vault address derivation
npm run test:real-deposit           # found an already-funded vault from Tachi's own canonical mnemonic
npm run test:real-fresh-vault       # full self-funded path: new mnemonic -> real faucet -> real deposit
npm run test:real-register-vault    # the above, plus real ledger registration (TxDeposit -> TxVaultOpen)
```

No local setup needed — all four hit Tachi's live public regtest daemon directly, no mock involved. `test:real-fresh-vault` and `test:real-register-vault` each take real regtest wallets through a real faucet-confirmation cycle (~10-20 minutes on this chain's own mining schedule). See `PROGRESS.md` for exactly what each one proves, the real txids/hashes produced, and every real daemon/SDK behavior discovered along the way that isn't documented anywhere Tachi publishes.

## Run the full demo

```bash
# terminal 1 — hosts the demo API and the shared registry
npm run dev:api

# terminal 2 — Agent B, the agent-to-agent counterparty (registers a real verified bond on startup)
npm run dev:agent-b

# terminal 3 — the React dashboard
npm run dev:agent
```

Start `dev:api` before `dev:agent-b` so Agent B's startup registration has a registry to reach — it's a best-effort call and won't crash Agent B if the registry isn't up yet, but you'll want the listing for the demo.

Open the agent app at the URL Vite prints:

- **Pay the insight API (25 sats · agent→service)** and **Pay Agent B for a fact-check (10 sats · agent→agent)** both settle live and update the wallet balance and spend log, tagged by which kind of payment they were — same SDK, same protocol, different counterparty. Each also logs a real "Tachi daemon reachable" check.
- **Pay for premium insight (75 sats · above auto-approve)** is priced between the spending mandate's auto-approve threshold and its per-request cap, so it's the one action that actually triggers the "Human confirmation needed" Approve/Deny prompt — click it to see the mandate hold a payment for a real yes/no before it's ever constructed. Click the cheaper buttons repeatedly instead and you'll hit the mandate's rolling-window cap, which blocks outright rather than asking.
- **Replay last payment (attack demo)** replays a captured `X-OBOL` header and watches the server reject it on the spot — Attack II from the paper, blocked, live.
- The **service registry** panel lists bonded services in real time. Both real listings show a ✓ and a real bonded amount, independently re-derived from a real Bitcoin L1 transaction. Click **Simulate Sybil (0 sats)** to register a fake, unverified service and watch it land at the bottom every time — even if you have it self-report a fake bond of 999,999,999 sats, a verified listing still outranks it.
- The **HAT proof** panel fetches a live Hash-Anchored Timestamp proof from Tachi's real daemon for a vault this project generated, funded, and registered on Tachi's real ledger itself.

## Or verify end-to-end over real HTTP from the command line

```bash
npm run dev:api          # terminal 1, leave running
npm run dev:agent-b       # terminal 2, leave running

npm run test:e2e          # agent → service payment, then a rejected replay
npm run test:e2e-a2a      # agent → agent payment, against apps/agent-b
npm run test:registry     # confirms an unverified 0-sat listing ranks below verified ones
```

## Current limitation: Tachi has no public API yet for third-party VTXO-transfer cosigning

This is the single thing standing between this project's current state and a fully real, end-to-end settlement — worth stating plainly rather than burying it.

**What's missing:** Tachi's cooperative multisig quorum (5-of-7 KDHT) can cosign a transfer, but the only publicly available signing path (`cosignRefund`) is structurally scoped to refund-to-self. There is currently no public API for a client to collect the quorum's cosignature on a transfer to an *arbitrary third party* — which is exactly what a payment protocol needs for its core "pay someone else" operation.

**How we know, concretely:**
- Confirmed directly by Tachi's own team over Telegram (2026-08-18/19) — not inferred from absence of docs.
- Independently re-confirmed by reading the actual SDK surface (`@tachibtc/taurus-vault-core`'s exported functions) rather than taking the team's word alone.
- Re-checked after Tachi deployed a patch on 2026-09-23 (`@tachibtc/taurus-vault-core` 0.3.3 → 0.3.5), in case it resolved this. It didn't: a full diff of the compiled package (README, type declarations, and compiled JS) showed the entire change was scoped to `discoverVaults()` gaining a new `onVaultError` callback for per-record failure isolation — unrelated to cosigning. `cosignRefund`'s implementation is byte-identical before and after. Directly probing the live daemon for plausible new RPC endpoint names (`tachi_cosignTransfer`, `tachi_transferCosign`, `tachi_cosign`, etc.) also returned nothing.
- Tachi's team has acknowledged this as a filed feature request under active review, not something ruled out — this is a current gap, not a stated design decision.

**What it blocks:** the per-payment cosignature step in `packages/core/src/taurusAdapter.ts` (`cooperativeSign`) is a deliberate, clearly-labeled stand-in rather than a real call to the quorum, because the real call doesn't exist to make yet. Everything upstream and downstream of that one step — vault creation, real faucet funding, real ledger registration, HAT-proof verification, and the bond-verification registry — is genuinely wired to Tachi's live daemon and independently checked, not mocked. This is the one piece that can't be made real without Tachi shipping the capability, and it's structured so that fact doesn't block anything else in the repo from being genuinely proven. See `PROGRESS.md` for the full verification trail.

## Status

This is a hackathon build, not a finished product — but more of it is genuinely real than a typical hackathon scaffold, and what isn't is clearly labeled rather than glossed over.

**Real and independently verified, not just asserted:** the daemon connection (`packages/core/src/daemonClient.ts`), vault derivation and funding via Tachi's real faucet (`scripts/real-sdk-fresh-vault-test.ts`), full ledger registration of a real vault (`scripts/real-sdk-register-vault-test.ts` — fresh mnemonic through a committed `TxVaultOpen`, confirmed afterward via `GET /tachi_listVaults` and `GET /tachi_tx`), the HAT-proof panel (points at that same real, registered vault), and the registry's bond verification (`packages/core/src/bondProof.ts` — a real BIP340-signed challenge proves control of a vault's owner key, and the bonded amount is independently re-derived from the real Bitcoin L1 output, not trusted from either party's claim).

**Still a deliberate, clearly-labeled stand-in:** the per-payment cosignature in `packages/core/src/taurusAdapter.ts` — see "Current limitation" above.

See `PROGRESS.md` for the full trail — every script run, every real txid/hash, and every real (often undocumented) daemon or SDK behavior found getting each piece working — and `docs/positioning.md` for exactly what's proven, what's a hypothesis, and what should never be overclaimed in submission materials.
