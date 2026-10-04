import { useEffect, useState } from "react";
import { REGISTRY_URL } from "../lib/nibiSetup";

interface BondedListing {
  serviceId: string;
  bondedSats: number;
  registeredAt: number;
  verified: boolean;
  vaultAddress?: string;
}

/**
 * The Attack IV demo beat: in the reference x402 discovery paper, five
 * fake listings captured 60%+ of simulated traffic because registration
 * was free. Two real tiers here, not one: a "verified" listing (green
 * checkmark) proved control of a real vault via a signed challenge, and its
 * bondedSats was independently re-derived from the real Bitcoin L1 output —
 * see @nibi/core's bondProof.ts. An unverified listing is still just a
 * self-reported claim — but verified listings always outrank unverified
 * ones regardless of the number claimed, which is what actually closes the
 * paper's finding (a Sybil can still register for free, but it can no
 * longer buy priority by simply claiming a bigger number).
 */
export function RegistryPanel() {
  const [listings, setListings] = useState<BondedListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch(REGISTRY_URL);
      if (!res.ok) throw new Error(`Registry responded ${res.status}`);
      setListings(await res.json());
      setError(null);
    } catch (err) {
      setError((err as Error).message + " — is apps/demo-api running? The registry is hosted there.");
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  async function simulateSybilListing() {
    setBusy(true);
    try {
      const fakeId = `free-data-api-${Math.random().toString(36).slice(2, 7)}`;
      await fetch(REGISTRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: fakeId, bondedSats: 0 }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <h2 className="text-[13px] font-semibold text-slate-100">Service registry (TAURUS-bonded)</h2>
        <button
          onClick={simulateSybilListing}
          disabled={busy}
          className="bg-white/[0.06] border border-white/10 text-slate-300 text-[11px] px-2.5 py-1.5 rounded disabled:opacity-50 whitespace-nowrap"
        >
          Simulate Sybil (0 sats)
        </button>
      </div>
      <p className="text-[11.5px] text-slate-500 leading-relaxed mb-2.5">
        Faking a listing costs nothing on a typical discovery layer — the paper this design responds
        to reproduced 60%+ traffic capture from five fake registrations. Verified listings (✓) proved
        control of a real vault via a signed challenge, and their bond is read from the real Bitcoin
        transaction, not claimed — they always outrank unverified ones, no matter what number a Sybil
        listing self-reports.
      </p>
      {error && <div className="text-xs text-rose-400 mb-2">{error}</div>}
      <div className="flex flex-col gap-[5px]">
        {listings.map((listing) => {
          const style = listing.verified
            ? { row: "bg-emerald-500/[0.06] border-emerald-500/25", name: "text-emerald-200", bond: "text-emerald-400" }
            : listing.bondedSats > 0
              ? { row: "bg-amber-500/5 border-amber-500/20", name: "text-amber-200", bond: "text-amber-400" }
              : { row: "bg-transparent border-white/[0.06] opacity-55", name: "text-slate-400", bond: "text-slate-500" };
          return (
            <div key={listing.serviceId} className={`flex items-center justify-between gap-2 rounded border px-2.5 py-2 ${style.row}`}>
              <span className={`font-mono text-xs truncate ${style.name}`}>
                {listing.verified && <span className="text-emerald-400 mr-1">✓</span>}
                {listing.serviceId}
              </span>
              <span className={`font-mono text-[11.5px] flex-none ${style.bond}`}>
                {listing.bondedSats.toLocaleString()} sats {listing.verified ? "bonded (verified)" : "claimed"}
              </span>
            </div>
          );
        })}
        {listings.length === 0 && !error && <div className="text-[13px] text-slate-500">Loading registry…</div>}
      </div>
    </div>
  );
}
