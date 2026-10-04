import { useEffect, useMemo, useState } from "react";
import type { PaymentEvent } from "@nibi/client";
import { createDemoClient, DEMO_API_URL, AGENT_B_URL, PREMIUM_INSIGHT_URL, DEMO_MANDATE } from "./lib/nibiSetup";
import { SettlementConsole, type Packet } from "./components/WalletDashboard";
import { SpendLog, type LogEntry } from "./components/SpendLog";
import { RegistryPanel } from "./components/RegistryPanel";
import { VaultProofPanel } from "./components/VaultProofPanel";

const STARTING_BALANCE = 500;

interface PendingConfirm {
  resolve: (approved: boolean) => void;
  priceSats: number;
}

export default function App() {
  const client = useMemo(() => createDemoClient(), []);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [spent, setSpent] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lastObolHeader, setLastObolHeader] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [pulse, setPulse] = useState(false);
  const [, forceTick] = useState(0);

  // The mandate's rolling window (real state inside NibiClient's
  // MandateEnforcer) empties on its own over time, not just on a new
  // payment — re-render periodically so the window bar reflects that.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const windowSpent = client
    .getSpendLog()
    .filter((r) => r.at >= Date.now() - DEMO_MANDATE.windowMs)
    .reduce((sum, r) => sum + r.amountSats, 0);

  function pushLog(entry: Omit<LogEntry, "id" | "at">) {
    setLog((prev) => [{ ...entry, id: crypto.randomUUID(), at: Date.now() }, ...prev]);
  }

  function firePacket(dir: "left" | "right", color: string) {
    const id = crypto.randomUUID();
    setPackets((prev) => [...prev, { id, dir, color }]);
    setTimeout(() => setPackets((prev) => prev.filter((p) => p.id !== id)), 650);
    setPulse(true);
    setTimeout(() => setPulse(false), 500);
  }

  async function runPayment(url: string, kind: "Agent→Service" | "Agent→Agent") {
    setBusy(true);
    try {
      const response = await client.fetch(url, {
        onPaymentEvent: (event: PaymentEvent) => {
          if (event.type === "blocked") {
            pushLog({ label: `[${kind}] Blocked by spending mandate`, detail: event.reason, tone: "blocked" });
          }
          if (event.type === "awaiting-confirmation") {
            pushLog({
              label: `[${kind}] Above auto-approve threshold — awaiting confirmation`,
              detail: `${event.challenge.priceSats} sats for ${event.challenge.resourcePath}`,
              tone: "pending",
            });
          }
          if (event.type === "paid") {
            setLastObolHeader(event.obolHeader);
            setBalance((b) => b - event.challenge.priceSats);
            setSpent((s) => s + event.challenge.priceSats);
            firePacket(kind === "Agent→Agent" ? "left" : "right", kind === "Agent→Agent" ? "#38bdf8" : "#34d399");
            pushLog({
              label: `[${kind}] Payment settled`,
              detail: `${event.challenge.priceSats} sats · payment_id ${event.challenge.paymentId.slice(0, 8)}…`,
              tone: "success",
            });
          }
          if (event.type === "denied") {
            pushLog({
              label: `[${kind}] Payment denied`,
              detail: `Human did not approve ${event.challenge.priceSats} sats for ${event.challenge.resourcePath}`,
              tone: "blocked",
            });
          }
        },
        confirmAboveThreshold: (challenge) =>
          new Promise<boolean>((resolve) => {
            setPendingConfirm({ resolve, priceSats: challenge.priceSats });
          }),
      });

      const body = await response.json();
      pushLog({
        label: `[${kind}] Resource received`,
        detail: body.insight ?? body.fact ?? JSON.stringify(body),
        tone: "success",
      });

      // Real, not simulated: whether the live Tachi daemon actually answered
      // when this payment settled (see packages/core/src/daemonClient.ts).
      const obolResponse = response.headers.get("X-OBOL-RESPONSE");
      if (obolResponse) {
        const { daemonReachable } = JSON.parse(obolResponse) as { daemonReachable: boolean };
        pushLog({
          label: `[${kind}] Real Tachi daemon check`,
          detail: daemonReachable
            ? "rpc-regtest.tachibtc.com was reachable at settlement time"
            : "rpc-regtest.tachibtc.com was NOT reachable — settlement stand-in still ran, but the live network check failed",
          tone: daemonReachable ? "success" : "blocked",
        });
      }
    } catch (err) {
      pushLog({ label: `[${kind}] Request failed`, detail: (err as Error).message, tone: "blocked" });
    } finally {
      setBusy(false);
    }
  }

  async function replayLastPayment() {
    if (!lastObolHeader) return;
    const res = await fetch(DEMO_API_URL, { headers: { "X-OBOL": lastObolHeader } });
    const body = await res.json().catch(() => ({}));
    pushLog({
      label: `Replay attempt → server responded ${res.status}`,
      detail: res.ok ? "Unexpected: replay was accepted" : (body.error ?? "Rejected"),
      tone: res.ok ? "blocked" : "attack",
    });
  }

  function resolveConfirm(approved: boolean) {
    pendingConfirm?.resolve(approved);
    setPendingConfirm(null);
  }

  return (
    <div className="min-h-screen bg-[#0d0f13] text-slate-100 p-6 sm:p-10">
      <div className="max-w-[920px] mx-auto bg-[#0a0c10] border border-white/[0.08] rounded-lg p-6 sm:p-9 relative">
        <div className="flex items-center gap-[7px] mb-[18px]">
          <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[10.5px] tracking-[0.08em] text-slate-500 uppercase">
            live · tachi regtest · demo-agent-01
          </span>
        </div>

        <header className="mb-6">
          <h1 className="text-[26px] font-bold tracking-tight text-slate-50 mb-2">Nibi Demo Agent</h1>
          <p className="text-sm leading-relaxed text-slate-400 max-w-[580px]">
            An autonomous agent paying per-request in sats via the Nibi SDK, under a signed spending mandate —
            to a plain service, and to another agent.
          </p>
        </header>

        <SettlementConsole
          balanceSats={balance}
          spentSats={spent}
          startingBalanceSats={STARTING_BALANCE}
          windowSpentSats={windowSpent}
          windowMaxSats={DEMO_MANDATE.maxSatsPerWindow}
          windowSeconds={DEMO_MANDATE.windowMs / 1000}
          packets={packets}
          pulse={pulse}
        />

        <div className="flex flex-wrap gap-2.5 my-6">
          <ActionButton
            accent="#34d399"
            onClick={() => runPayment(DEMO_API_URL, "Agent→Service")}
            disabled={busy}
            label="Pay the insight API (25 sats · agent→service)"
          />
          <ActionButton
            accent="#38bdf8"
            onClick={() => runPayment(AGENT_B_URL, "Agent→Agent")}
            disabled={busy}
            label="Pay Agent B for a fact-check (10 sats · agent→agent)"
          />
          <ActionButton
            accent="#f59e0b"
            onClick={() => runPayment(PREMIUM_INSIGHT_URL, "Agent→Service")}
            disabled={busy}
            label="Pay for premium insight (75 sats · above auto-approve)"
          />
          <ActionButton
            accent="rgba(251,113,133,.9)"
            onClick={replayLastPayment}
            disabled={!lastObolHeader}
            label="Replay last payment (attack demo)"
          />
        </div>

        {pendingConfirm && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded-lg z-10 p-6">
            <div className="w-full max-w-[360px] bg-[#14171d] border border-white/10 border-t-[3px] border-t-amber-500 rounded p-5 shadow-2xl">
              <div className="text-sm font-semibold text-slate-50 mb-2">Human confirmation needed</div>
              <div className="text-[13px] text-amber-300/80 leading-relaxed mb-4">
                {pendingConfirm.priceSats} sats exceeds the auto-approve threshold.
              </div>
              <div className="flex gap-2.5">
                <button
                  onClick={() => resolveConfirm(true)}
                  className="flex-1 bg-amber-500 text-[#1a1206] rounded py-2.5 text-[13px] font-semibold"
                >
                  Approve
                </button>
                <button
                  onClick={() => resolveConfirm(false)}
                  className="flex-1 bg-white/[0.08] text-slate-300 rounded py-2.5 text-[13px] font-semibold"
                >
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6">
          <div className="font-mono text-[10.5px] tracking-[0.08em] text-slate-500 uppercase mb-2.5 border-b border-white/[0.08] pb-2">
            Activity
          </div>
          <SpendLog entries={log} />
        </div>

        <div className="font-mono text-[10.5px] tracking-[0.08em] text-slate-500 uppercase mb-3.5 border-b border-white/[0.08] pb-2">
          System proofs
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          <RegistryPanel />
          <VaultProofPanel />
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  accent,
  onClick,
  disabled,
  label,
}: {
  accent: string;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ borderTopColor: accent }}
      className="flex-1 min-w-[240px] text-left bg-[#12151b] border border-white/10 border-t-[3px] rounded px-4 py-3.5 text-[12.5px] font-medium text-slate-100 disabled:opacity-50 transition-opacity"
    >
      <span
        style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
        className="inline-block w-[6px] h-[6px] rounded-full mr-2.5 align-middle"
      />
      {label}
    </button>
  );
}
