import type { TachiClient } from "@tachibtc/tachi-sdk-ts";

/**
 * Real HAT/RIP proof lookup — genuinely wired to Tachi's daemon, not a
 * stand-in. `client.getTransaction(hash, { hat, rip })` returns a real
 * Hash-Anchored Timestamp proof (and RIP payload, when present) for a real
 * transaction on Tachi's live regtest network. This is the same "let a
 * third party independently verify off-chain state against Bitcoin without
 * trusting an operator" property the original briefing (§4 step 6, §5
 * Attack I) describes.
 *
 * Be precise about what this proves and what it doesn't. Since
 * scripts/real-sdk-register-vault-test.ts, apps/demo-api's default proof
 * txid IS our own vault's real TxVaultOpen — registered end to end (fresh
 * mnemonic -> real faucet -> real L1 deposit -> real ledger TxDeposit ->
 * real registerVault), independently confirmed via GET /tachi_listVaults
 * and this same endpoint before being wired in. What it still does NOT
 * prove: `btcHeight`/`btcTimestamp` read 0 for this transaction too — same
 * as every other real transaction sampled on this network — because that's
 * Tachi's own anchoring batch lagging network-wide, unrelated to whether a
 * vault is registered. And it says nothing about a specific Nibi payment:
 * third-party transfer cosigning is still blocked (see taurusAdapter.ts),
 * so the Obol flow's per-request cosignature stays a labeled stand-in
 * regardless of anything in this file. Don't imply otherwise in the UI or
 * submission materials.
 */
export interface VaultProofResult {
  txid: string;
  found: boolean;
  hasHat: boolean;
  /**
   * Deliberately not a boolean "present/absent" — the daemon 400s on
   * `rip=true` without an `origin_epoch`/`final_epoch` range (confirmed by
   * hand), and there's no principled range to pick for an arbitrary txid in
   * a demo context. Reported as "not queried" rather than a guessed range
   * that could misreport an unrelated epoch window as "absent."
   */
  ripQueried: false;
  btcHeight?: number;
  btcTimestamp?: number;
  vtxoId?: string;
  proof?: string;
  error?: string;
}

/**
 * One retry after a short delay — this public regtest daemon is known to
 * intermittently 502 (Tachi's own team flagged transient indexer hiccups in
 * their Telegram, 2026-08-18). Confirmed by hand: an immediate retry after a
 * 502 typically succeeds. Without this, a demo running live risks showing a
 * false "proof unavailable" from nothing more than network flakiness.
 */
export async function fetchVaultProof(client: TachiClient, txid: string): Promise<VaultProofResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tx = await client.getTransaction(txid, { hat: true });
      return {
        txid,
        found: true,
        hasHat: !!tx.hat,
        ripQueried: false,
        btcHeight: tx.hat?.btc_height,
        btcTimestamp: tx.hat?.btc_timestamp,
        vtxoId: tx.hat?.vtxo_id,
        proof: tx.hat?.proof,
      };
    } catch (err) {
      if (attempt === 1) {
        return { txid, found: false, hasHat: false, ripQueried: false, error: (err as Error).message };
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  // unreachable, satisfies the type checker
  return { txid, found: false, hasHat: false, ripQueried: false, error: "unreachable" };
}
