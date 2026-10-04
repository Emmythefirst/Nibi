import { sha256Hex } from "./commitment.js";
import { createDaemonClient, probeDaemonHealth, type DaemonHealth } from "./daemonClient.js";

/**
 * The seam between Nibi's protocol logic and Tachi's actual settlement
 * layer. Every place that talks to Tachi goes through this interface.
 *
 * Tachi's real SDKs shipped 2026-08-18 (@tachibtc/tachi-sdk-ts,
 * @tachibtc/taurus-vault-core, @tachibtc/taurus-wallet-aggregator, all
 * public on npm). This file was rewritten against them. One blocker to
 * real settlement has since been resolved; one remains, confirmed
 * directly by Tachi's own team (Telegram, 2026-08-18/19) — not a guess:
 *
 * 1. FUNDING — RESOLVED. faucet.tachibtc.com (undocumented but real;
 *    reverse-engineered from its own JS bundle: POST /api/faucet with
 *    { address, amountBtc }) funds a fresh regtest wallet for real. See
 *    scripts/real-sdk-fresh-vault-test.ts for a full generate-mnemonic ->
 *    faucet -> createVault -> depositToVault run, no shortcuts.
 *
 * 2. THIRD-PARTY COSIGNING — still genuinely unavailable, confirmed by
 *    Tachi directly, not merely undocumented. Quoting their team: "There's
 *    currently no public RPC for a client to collect the 5-of-7 quorum's
 *    partials on a plain third-party VTXO transfer... it doesn't exist as
 *    a public-facing feature yet." cosignRefund (POST
 *    /tachi_signTransaction) is structurally scoped to refund-to-self —
 *    each quorum member independently rebuilds the vault's own to_local
 *    output and only signs if the destination matches it, so it can't be
 *    pointed at a third party. The general-transfer path
 *    (VaultCosignAnnouncement, topic tachi/vault/v1) is internal
 *    validator-to-validator gossip, wired up only inside the daemon's own
 *    node process. Tachi invited flagging this as a feature request if
 *    it's blocking a bounty build — worth doing (see PROGRESS.md).
 *
 * Net effect: funding is real and working; paying an ARBITRARY third party
 * still isn't achievable against Tachi's current public surface, through
 * no fault of anything in this codebase. Until Tachi ships a client-facing
 * transfer-cosign endpoint, the actual signature/verification below stays
 * a clearly-labeled stand-in — but it now runs alongside a REAL daemon
 * health probe (see probeDaemonHealth in daemonClient.ts) so a receipt
 * honestly reflects whether the live Tachi network was reachable when the
 * payment was made.
 *
 * See scripts/real-sdk-smoke-test.ts (daemon + vault derivation, no
 * funding needed), real-sdk-deposit-test.ts (found an already-funded
 * vault by accident), and real-sdk-fresh-vault-test.ts (full self-funded
 * path) for proof the vault/wallet SDKs work end to end — kept separate
 * from the live demo so the demo never depends on an address that can't
 * actually receive a THIRD-PARTY payment, which is the one thing still
 * missing.
 */
export interface CooperativeSignResult {
  cosignature: string;
  settledAt: number;
  /** Real, not simulated — null if the daemon couldn't be reached at all. */
  daemon: DaemonHealth;
}

export interface TaurusAdapter {
  /**
   * Client-side: has the Tachi node cooperatively co-sign a VTXO transfer
   * for `amountSats` to `payTo`, bound to `commitmentHash`. In Tachi's real
   * model this is near-immediate (cooperative co-signing), not a
   * probabilistic on-chain confirmation — that property is what lets
   * Nibi close Attack I (revert-grant under optimistic execution)
   * instead of just hoping a reorg doesn't happen.
   */
  cooperativeSign(input: {
    payTo: string;
    amountSats: number;
    commitmentHash: string;
  }): Promise<CooperativeSignResult>;

  /**
   * Server-side: independently verify that a cosignature is real and
   * matches the exact payment terms it claims to settle. This is what
   * "gate access on verified settlement" actually means in code.
   */
  verifyCosignature(input: {
    cosignature: string;
    payTo: string;
    amountSats: number;
    commitmentHash: string;
  }): Promise<boolean>;
}

/**
 * HYBRID IMPLEMENTATION — real daemon probe, stand-in signature.
 *
 * The cosignature itself is still deterministic and shared-secret based, for
 * the two specific, cited reasons in the file-level comment above (no
 * faucet; no client-callable RPC for third-party transfer cosigning). It
 * lets two independent processes (the demo-api server and the demo-agent
 * browser app) each construct and verify cosignatures without sharing
 * in-memory state — standing in for the shared, Bitcoin-anchored settlement
 * state a real Tachi network would give both sides independently.
 *
 * What's genuinely real: every call also probes the live Tachi daemon
 * (default `https://rpc-regtest.tachibtc.com`, override with
 * TACHI_DAEMON_URL) via @tachibtc/tachi-sdk-ts and reports whether it was
 * actually reachable. That result rides along on the receipt
 * (ObolReceipt.daemonReachable) instead of being silently discarded — a
 * demo running with the real network down will honestly show that, rather
 * than a fabricated "connected" status.
 *
 * Deliberately does NOT prevent replay by itself — a replayed cosignature
 * will still verify as "valid" here, exactly as a real settlement proof
 * would. Replay protection is the server registry's job (see
 * @nibi/server's ObolRegistry), which is the correct place for it: the
 * payment is real, the *reuse* is what must be rejected.
 */
const MOCK_NETWORK_SECRET = "nibi-mock-tachi-network-v1";

export function createMockTaurusAdapter(daemonUrl?: string): TaurusAdapter {
  const daemon = createDaemonClient(daemonUrl);

  return {
    async cooperativeSign({ payTo, amountSats, commitmentHash }) {
      const [, health] = await Promise.all([
        delay(150 + Math.random() * 150), // simulated settlement latency for the stand-in signature
        probeDaemonHealth(daemon),
      ]);
      const cosignature = await sha256Hex(`${MOCK_NETWORK_SECRET}|${payTo}|${amountSats}|${commitmentHash}`);
      return { cosignature, settledAt: Date.now(), daemon: health };
    },
    async verifyCosignature({ cosignature, payTo, amountSats, commitmentHash }) {
      const expected = await sha256Hex(`${MOCK_NETWORK_SECRET}|${payTo}|${amountSats}|${commitmentHash}`);
      return cosignature === expected;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
