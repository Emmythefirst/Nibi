import { useEffect, useState } from "react";
import { DEMO_API_URL } from "../lib/nibiSetup";

const PROOF_URL = new URL("/registry/proof", DEMO_API_URL).toString();

interface VaultProof {
  txid: string;
  found: boolean;
  hasHat: boolean;
  ripQueried: false;
  btcHeight?: number;
  btcTimestamp?: number;
  vtxoId?: string;
  proof?: string;
  error?: string;
}

/**
 * Demonstrates that Tachi's HAT verification mechanism — "let a third party
 * independently check off-chain state against Bitcoin without trusting an
 * operator" (briefing §4 step 6, §5 Attack I) — is real, not simulated.
 * Fetches a live proof from Tachi's daemon for our own vault's real
 * TxVaultOpen (scripts/real-sdk-register-vault-test.ts: fresh mnemonic ->
 * real faucet -> real L1 deposit -> real ledger registration), not a
 * borrowed network transaction — see the long comment in
 * packages/core/src/hatProof.ts for the full trail and independent
 * verification.
 *
 * Still precise about scope: this is NOT a specific Nibi payment's
 * settlement proof — third-party transfer cosigning is a separate,
 * still-blocked capability (taurusAdapter.ts). And the Bitcoin anchor
 * height/timestamp below will read 0 regardless of whose vault this is —
 * that's Tachi's own anchoring batch lagging network-wide, not something
 * either registering a vault or making a payment can change.
 */
export function VaultProofPanel() {
  const [proof, setProof] = useState<VaultProof | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ tx?: boolean; vtxo?: boolean }>({});

  async function refresh() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(PROOF_URL);
      setProof(await res.json());
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function copy(key: "tx" | "vtxo", value: string) {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied((c) => ({ ...c, [key]: true }));
    setTimeout(() => setCopied((c) => ({ ...c, [key]: false })), 1200);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <h2 className="text-[13px] font-semibold text-slate-100">Real HAT proof</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="bg-white/[0.06] border border-white/10 text-slate-300 text-[11px] px-2.5 py-1.5 rounded disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5"
        >
          <span className={loading ? "inline-block animate-spin" : "inline-block"}>↻</span> Re-verify
        </button>
      </div>
      <p className="text-[11.5px] text-slate-500 leading-relaxed mb-2.5">
        Fetched right now from Tachi's own daemon, for a vault we generated, funded via the real faucet, and
        registered on Tachi's real ledger ourselves — not a mock, not borrowed from someone else's
        transaction. It's still independent of any specific payment made in this demo; see below for what it
        does and doesn't prove.
      </p>

      {fetchError && (
        <div className="text-xs text-rose-400">
          {fetchError} — is apps/demo-api running with NIBI_VAULT_PROOF_TXID set?
        </div>
      )}

      {proof && !proof.found && (
        <div className="text-xs text-rose-400">
          {proof.error ?? "Proof unavailable"} — is apps/demo-api running with NIBI_VAULT_PROOF_TXID set?
        </div>
      )}

      {proof?.found && (
        <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1.5 text-[11.5px]">
          <div className="text-slate-500">Tx</div>
          <div className="font-mono text-slate-300 flex items-center gap-1.5 overflow-hidden">
            <span className="truncate" title={proof.txid}>
              {proof.txid}
            </span>
            <button
              onClick={() => copy("tx", proof.txid)}
              className="flex-none text-[10.5px] px-1"
              style={{ color: copied.tx ? "#34d399" : "#64748b" }}
            >
              {copied.tx ? "copied" : "copy"}
            </button>
          </div>

          <div className="text-slate-500">Proof</div>
          <div className={proof.hasHat ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>
            {proof.hasHat ? "present" : "absent"}
          </div>

          {proof.vtxoId && (
            <>
              <div className="text-slate-500">VTXO</div>
              <div className="font-mono text-slate-300 flex items-center gap-1.5 overflow-hidden">
                <span className="truncate" title={proof.vtxoId}>
                  {proof.vtxoId}
                </span>
                <button
                  onClick={() => copy("vtxo", proof.vtxoId!)}
                  className="flex-none text-[10.5px] px-1"
                  style={{ color: copied.vtxo ? "#34d399" : "#64748b" }}
                >
                  {copied.vtxo ? "copied" : "copy"}
                </button>
              </div>
            </>
          )}

          <div className="text-slate-500">Anchored</div>
          <div className="font-mono text-slate-500">
            {proof.btcHeight ? `height ${proof.btcHeight}` : "not yet (0 — real network state)"}
          </div>

          <div className="text-slate-500">RIP</div>
          <div className="font-mono text-slate-500">not queried (needs an epoch range)</div>
        </div>
      )}

      {!proof && !fetchError && <div className="text-[13px] text-slate-500">Loading proof…</div>}
    </div>
  );
}
